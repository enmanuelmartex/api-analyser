import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { isTransportFailure } from './transports/mail-transport';
import type { MailTransport, RelayPayload } from './transports/mail-transport';
import { RelayTransport } from './transports/relay.transport';
import { ResendTransport } from './transports/resend.transport';

export type { RelayPayload } from './transports/mail-transport';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

export interface SendEmailInput {
  /**
   * Stable across every retry of the same logical send, distinct for genuinely
   * different ones. Conventionally `<template>:<entityId>:<userId>`.
   *
   * This is the entire duplicate-suppression mechanism, and it is enforced by a
   * unique index rather than by a check-then-insert — two workers racing on the
   * same key both attempt the insert, and exactly one wins.
   */
  idempotencyKey: string;
  userId?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Which template produced it. Recorded, and used to route notifications. */
  template: string;
  entityType?: string;
  entityId?: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Carried onto the emitted event so a notification can name the project. */
  projectName?: string;
  /**
   * The same message expressed as values rather than markup.
   *
   * Required for anything that must be able to travel through the hosted
   * relay, which renders its own templates and refuses HTML. A message without
   * one still sends fine through a local Resend key; through the relay it is
   * recorded as FAILED with a reason saying so, rather than arriving wrong.
   */
  relay?: RelayPayload;
}

export type SendResult =
  | { status: 'SENT'; deliveryId: string; providerMessageId?: string }
  | { status: 'SKIPPED'; reason: string; deliveryId?: string }
  | { status: 'FAILED'; reason: string; deliveryId?: string };

/**
 * The only place in the application that knows how mail leaves it.
 *
 * Callers ask for a message to be sent and get a result back. They do not
 * import a provider SDK, do not see a credential, and do not decide what
 * happens on failure — which is what keeps provider-specific handling out of
 * the report, scan and issue services, and makes changing how mail is delivered
 * a change to this file and the transports beside it.
 *
 * Two invariants it owns:
 *
 *   1. **Idempotency.** Every send is recorded in `email_deliveries` under a
 *      unique key BEFORE the transport is called. A retried job finds the key
 *      taken and returns without sending, so "Report ready" cannot arrive three
 *      times because a queue redelivered its job.
 *
 *   2. **Secrecy.** No credential is logged, included in an error message, or
 *      stored on a delivery row. Each transport redacts its own before
 *      returning, because it is the only code that knows what its credential
 *      looks like.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** The chosen transport, or null when this install cannot send mail at all. */
  private readonly transport: MailTransport | null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {
    this.transport = this.selectTransport();
  }

  /**
   * Picks how mail leaves this installation. Once, at construction.
   *
   * `RESEND_API_KEY` wins when it is set, because setting it is an explicit
   * choice to own the sending domain and the delivery path — an operator who
   * has done that work should not silently be routed through someone else's
   * service. The relay is the fallback, and for most self-hosted installs it is
   * the only one configured: it is what lets them send branded mail from a
   * verified domain without obtaining a Resend account at all.
   *
   * Neither configured is a normal state, not an error. Email is an addition to
   * this product, not a dependency of it: scans run, reports generate and in-app
   * notifications work regardless, and every send is recorded as SKIPPED with a
   * reason so "why did I never get an email" has an answer.
   */
  private selectTransport(): MailTransport | null {
    const apiKey = this.config.get<string>('email.apiKey') ?? '';
    const fromEmail = this.config.get<string>('email.fromEmail') ?? '';
    const fromName = this.config.get<string>('email.fromName') ?? 'API Analyzer';

    const resend = new ResendTransport(apiKey, `${fromName} <${fromEmail}>`);
    if (resend.isConfigured()) {
      this.logger.log(`[Email] Sending directly through Resend as ${fromEmail}.`);
      return resend;
    }

    const relay = new RelayTransport(
      this.config.get<string>('email.relayUrl') ?? '',
      this.config.get<string>('email.relayToken') ?? '',
    );
    if (relay.isConfigured()) {
      this.logger.log(
        `[Email] Sending through the API Analyser mail relay at ` +
          `${this.config.get<string>('email.relayUrl')}.`,
      );
      return relay;
    }

    this.logger.log(
      '[Email] Neither RESEND_API_KEY nor MAIL_RELAY_URL/MAIL_RELAY_TOKEN is set — ' +
        'outbound email is disabled. In-app notifications are unaffected.',
    );
    return null;
  }

  /** Whether a transport is configured at all. */
  isConfigured(): boolean {
    return this.transport !== null;
  }

  /** Which one, for the settings UI and for logs. */
  transportName(): string | null {
    return this.transport?.name ?? null;
  }

  /**
   * Sends one message, at most once per idempotency key.
   *
   * Never throws. Every outcome — sent, skipped, failed — is a returned value
   * and a row, because the callers are queue workers whose job must not fail
   * because a mail server was briefly unreachable. A failed report email leaves
   * the report itself untouched and downloadable.
   */
  async send(input: SendEmailInput): Promise<SendResult> {
    const transport = this.transport;
    if (!transport) {
      return this.recordSkipped(input, 'No email provider is configured.');
    }

    if (!input.to) {
      // A user with no address on file. Recorded rather than silently dropped,
      // so "why did I never get an email" has an answer.
      return this.recordSkipped(input, 'The recipient has no email address.');
    }

    // Claim the key first. If this insert loses, the message is already sent or
    // being sent by someone else, and this call must do nothing.
    let deliveryId: string;
    try {
      const delivery = await this.prisma.emailDelivery.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          userId: input.userId ?? null,
          toEmail: input.to,
          subject: input.subject,
          template: input.template,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          status: 'PENDING',
          attempts: 1,
        },
        select: { id: true },
      });
      deliveryId = delivery.id;
    } catch (error: any) {
      if (error?.code === UNIQUE_VIOLATION) {
        this.logger.log(
          `[Email] Delivery ${input.idempotencyKey} already exists; not sending a duplicate.`,
        );
        return { status: 'SKIPPED', reason: 'Already delivered.' };
      }
      throw error;
    }

    this.logger.log(
      `[Email] Sending ${input.template} to ${maskEmail(input.to)} via ${transport.name}`,
    );

    try {
      const result = await transport.send({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments,
        relay: input.relay,
      });

      // A transport never throws — a rejection is a returned value, already
      // redacted of whatever credential that transport holds.
      if (isTransportFailure(result)) {
        return this.recordFailure(deliveryId, input, result.reason);
      }

      await this.prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          failureReason: null,
        },
      });

      this.logger.log(`[Email] Successfully sent via ${transport.name} (delivery ${deliveryId})`);

      this.events.emit('email.sent', {
        deliveryId,
        userId: input.userId,
        template: input.template,
        entityType: input.entityType,
        entityId: input.entityId,
        providerMessageId: result.providerMessageId,
        projectName: input.projectName,
      });

      return { status: 'SENT', deliveryId, providerMessageId: result.providerMessageId };
    } catch (error) {
      // Only reachable if a transport breaks its own contract. Recorded rather
      // than propagated: the caller is a queue worker whose job must not fail
      // because a mail server was briefly unreachable.
      return this.recordFailure(deliveryId, input, (error as Error).message);
    }
  }

  /**
   * Has this message already been delivered?
   *
   * Only for callers that want to avoid assembling an expensive payload — the
   * report email reads a PDF off disk — before discovering the send is a no-op.
   * It is not the duplicate guard: that is the unique index, which holds even
   * when two callers pass this check simultaneously.
   */
  async alreadySent(idempotencyKey: string): Promise<boolean> {
    const existing = await this.prisma.emailDelivery.findUnique({
      where: { idempotencyKey },
      select: { status: true },
    });
    return existing !== null && existing.status !== 'FAILED';
  }

  private async recordSkipped(input: SendEmailInput, reason: string): Promise<SendResult> {
    this.logger.log(`[Email] Skipping ${input.template}: ${reason}`);

    const delivery = await this.prisma.emailDelivery
      .create({
        data: {
          idempotencyKey: input.idempotencyKey,
          userId: input.userId ?? null,
          toEmail: input.to || 'unknown',
          subject: input.subject,
          template: input.template,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          status: 'SKIPPED',
          failureReason: reason,
        },
        select: { id: true },
      })
      .catch(() => null);

    return { status: 'SKIPPED', reason, deliveryId: delivery?.id };
  }

  private async recordFailure(
    deliveryId: string,
    input: SendEmailInput,
    reason: string,
  ): Promise<SendResult> {
    await this.prisma.emailDelivery
      .update({
        where: { id: deliveryId },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      })
      .catch(() => null);

    this.logger.error(`[Email] Failed to send ${input.template} (delivery ${deliveryId}): ${reason}`);

    this.events.emit('email.failed', {
      deliveryId,
      userId: input.userId,
      template: input.template,
      entityType: input.entityType,
      entityId: input.entityId,
      reason,
      projectName: input.projectName,
    });

    return { status: 'FAILED', reason, deliveryId };
  }
}

/**
 * `ab***@example.com`. Used in logs so a delivery can be traced without writing
 * the full address into every log line.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[invalid address]';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
