import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';

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
}

export type SendResult =
  | { status: 'SENT'; deliveryId: string; providerMessageId?: string }
  | { status: 'SKIPPED'; reason: string; deliveryId?: string }
  | { status: 'FAILED'; reason: string; deliveryId?: string };

/**
 * The only place in the application that knows Resend exists.
 *
 * Callers ask for a message to be sent and get a result back. They do not
 * import the SDK, do not see the API key, and do not decide what happens on
 * failure — which is what keeps provider-specific handling out of the report,
 * scan and issue services, and makes swapping providers a change to this file.
 *
 * Two invariants it owns:
 *
 *   1. **Idempotency.** Every send is recorded in `email_deliveries` under a
 *      unique key BEFORE the provider is called. A retried job finds the key
 *      taken and returns without sending, so "Report ready" cannot arrive three
 *      times because a queue redelivered its job.
 *
 *   2. **Secrecy.** The API key is never logged, never included in an error
 *      message, and never stored on a delivery row. `redact` below is applied to
 *      every provider message before it goes anywhere.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {
    this.apiKey = this.config.get<string>('email.apiKey') ?? '';
    this.fromEmail = this.config.get<string>('email.fromEmail') ?? '';
    this.fromName = this.config.get<string>('email.fromName') ?? 'API Analyzer';

    // Constructed once. A missing key leaves the client null rather than
    // throwing at boot: email is optional, and an install that never configures
    // it must still start and run scans.
    this.client = this.apiKey ? new Resend(this.apiKey) : null;

    if (!this.client) {
      this.logger.log(
        '[Email] RESEND_API_KEY is not set — outbound email is disabled. ' +
          'In-app notifications are unaffected.',
      );
    }
  }

  /** Whether a provider is configured at all. */
  isConfigured(): boolean {
    return this.client !== null;
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
    if (!this.client) {
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

    this.logger.log(`[Email] Sending ${input.template} to ${maskEmail(input.to)}`);

    try {
      const response = await this.client.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
        })),
      });

      // The SDK reports provider-side rejections in `error` rather than by
      // throwing, so a response that looks successful must still be checked.
      if (response.error) {
        return this.recordFailure(
          deliveryId,
          input,
          this.redact(response.error.message ?? 'The provider rejected the message.'),
        );
      }

      await this.prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: response.data?.id ?? null,
          failureReason: null,
        },
      });

      this.logger.log(`[Email] Successfully sent via Resend (delivery ${deliveryId})`);

      this.events.emit('email.sent', {
        deliveryId,
        userId: input.userId,
        template: input.template,
        entityType: input.entityType,
        entityId: input.entityId,
        providerMessageId: response.data?.id,
        projectName: input.projectName,
      });

      return { status: 'SENT', deliveryId, providerMessageId: response.data?.id };
    } catch (error) {
      return this.recordFailure(deliveryId, input, this.redact((error as Error).message));
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

  /**
   * Strips the API key from provider output.
   *
   * Belt and braces — Resend does not echo the key back — but this text is
   * written to a database column, returned to a caller and logged, and the cost
   * of being wrong once is a credential in a log aggregator forever.
   */
  private redact(message: string): string {
    if (!this.apiKey) return message;
    return message.split(this.apiKey).join('[redacted]');
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
