import { describe, expect, it } from 'bun:test';
import { EmailService, maskEmail } from './email.service';
import type { OutboundMessage, TransportResult } from './transports/mail-transport';

/**
 * Delivery idempotency, transport selection, and the rules about what must
 * never leave this service.
 *
 * The important one is the duplicate guard: jobs retry, events are redelivered,
 * and "Report ready" arriving three times for one report is the failure mode the
 * unique `idempotencyKey` exists to prevent.
 *
 * Note what these tests do NOT do: reach a provider. `EmailService` talks to a
 * `MailTransport` and nothing else, so a fake one is the whole mock — there is
 * no SDK to intercept and no network call to forget to stub. The transports
 * themselves are tested beside their own files.
 */

const UNIQUE_VIOLATION = 'P2002';
const API_KEY = 're_test_secretkey123';
const RELAY_TOKEN = 'relay_test_token_value';

interface Options {
  /** Which credentials the environment appears to hold. */
  resendKey?: string;
  relayUrl?: string;
  relayToken?: string;
  /** Simulates the key already being claimed, as a concurrent send would. */
  keyTaken?: boolean;
  /** What the transport reports back. */
  transportResult?: TransportResult;
  existingDelivery?: { status: string } | null;
}

function makeService(options: Options = {}) {
  const rows: any[] = [];
  const updates: { id: string; data: any }[] = [];
  const emitted: { event: string; payload: any }[] = [];
  const sends: OutboundMessage[] = [];

  const prisma = {
    emailDelivery: {
      create: async ({ data }: any) => {
        if (options.keyTaken && data.status === 'PENDING') {
          const error: any = new Error('Unique constraint failed');
          error.code = UNIQUE_VIOLATION;
          throw error;
        }
        rows.push(data);
        return { id: `delivery_${rows.length}` };
      },
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, data });
        return { id: where.id };
      },
      findUnique: async () => options.existingDelivery ?? null,
    },
  };

  const config = {
    get: (key: string) =>
      ({
        'email.apiKey': options.resendKey ?? API_KEY,
        'email.fromEmail': 'security@example.com',
        'email.fromName': 'API Analyzer',
        'email.relayUrl': options.relayUrl ?? '',
        'email.relayToken': options.relayToken ?? '',
      })[key],
  };

  const events = {
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
      return true;
    },
  };

  const service = new EmailService(prisma as any, config as any, events as any);

  // Replace whichever transport was selected with one that records. The
  // selection itself is asserted separately, through `transportName()`.
  const selected = (service as any).transport;
  if (selected) {
    (service as any).transport = {
      name: selected.name,
      isConfigured: () => true,
      send: async (message: OutboundMessage): Promise<TransportResult> => {
        sends.push(message);
        return options.transportResult ?? { ok: true, providerMessageId: 'provider_msg_1' };
      },
    };
  }

  return { service, rows, updates, emitted, sends };
}

const INPUT = {
  idempotencyKey: 'report-ready:report_1:owner@example.com',
  userId: 'user_1',
  to: 'owner@example.com',
  subject: 'Scan complete — Production API',
  html: '<p>done</p>',
  text: 'done',
  template: 'report-ready',
  entityType: 'report',
  entityId: 'report_1',
  relay: {
    template: 'scan-report' as const,
    data: { projectName: 'Production API' },
  },
};

describe('EmailService transport selection', () => {
  it('prefers a local Resend key when one is set', () => {
    // Setting a provider key is an explicit choice to own the delivery path; an
    // operator who has done that work should not be routed elsewhere.
    const { service } = makeService({
      resendKey: API_KEY,
      relayUrl: 'https://mail.apianalyser.com',
      relayToken: RELAY_TOKEN,
    });

    expect(service.transportName()).toBe('resend');
    expect(service.isConfigured()).toBe(true);
  });

  it('falls back to the relay when there is no Resend key', () => {
    const { service } = makeService({
      resendKey: '',
      relayUrl: 'https://mail.apianalyser.com',
      relayToken: RELAY_TOKEN,
    });

    expect(service.transportName()).toBe('relay');
    expect(service.isConfigured()).toBe(true);
  });

  it('needs both halves of the relay configuration', () => {
    const { service } = makeService({ resendKey: '', relayUrl: 'https://mail.apianalyser.com' });

    // A URL with no token would produce a 401 on every send. Better to report
    // email as disabled and record the reason.
    expect(service.isConfigured()).toBe(false);
    expect(service.transportName()).toBeNull();
  });

  it('reports email as disabled when nothing is configured', () => {
    const { service } = makeService({ resendKey: '' });

    expect(service.isConfigured()).toBe(false);
    expect(service.transportName()).toBeNull();
  });
});

describe('EmailService.send', () => {
  it('sends the message and records the delivery as SENT', async () => {
    const { service, rows, updates, emitted, sends } = makeService();

    const result = await service.send(INPUT);

    expect(result.status).toBe('SENT');
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe('owner@example.com');

    // The row is claimed BEFORE the transport is called, which is what makes a
    // concurrent second send lose the race rather than duplicate the message.
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].idempotencyKey).toBe(INPUT.idempotencyKey);

    expect(updates[0].data.status).toBe('SENT');
    expect(updates[0].data.providerMessageId).toBe('provider_msg_1');
    expect(emitted[0].event).toBe('email.sent');
  });

  it('passes the relay payload through, so the relay can render it', async () => {
    const { service, sends } = makeService();

    await service.send(INPUT);

    expect(sends[0].relay).toEqual(INPUT.relay);
  });

  /**
   * The duplicate-email test.
   *
   * A retried job presents the same idempotency key. The insert loses, and the
   * transport must not be called at all.
   */
  it('does not send twice for the same idempotency key', async () => {
    const { service, sends, emitted } = makeService({ keyTaken: true });

    const result = await service.send(INPUT);

    expect(result.status).toBe('SKIPPED');
    expect(sends).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('skips, rather than fails, when no transport is configured', async () => {
    const { service, rows, sends } = makeService({ resendKey: '' });

    const result = await service.send(INPUT);

    expect(result.status).toBe('SKIPPED');
    expect(sends).toHaveLength(0);
    // Recorded with a reason, so "why did I never get an email" is answerable.
    expect(rows[0].status).toBe('SKIPPED');
    expect(rows[0].failureReason).toContain('No email provider');
  });

  it('skips when the recipient has no address', async () => {
    const { service, sends } = makeService();

    const result = await service.send({ ...INPUT, to: '' });

    expect(result.status).toBe('SKIPPED');
    expect(sends).toHaveLength(0);
  });

  it('records a transport rejection as FAILED and never throws', async () => {
    const { service, updates, emitted } = makeService({
      transportResult: { ok: false, reason: 'Domain not verified', retryable: false },
    });

    const result = await service.send(INPUT);

    expect(result.status).toBe('FAILED');
    expect(updates[0].data.status).toBe('FAILED');
    expect(updates[0].data.failureReason).toBe('Domain not verified');
    expect(emitted[0].event).toBe('email.failed');
  });

  it('truncates a long failure reason rather than overflowing the column', async () => {
    const { service, updates } = makeService({
      transportResult: { ok: false, reason: 'x'.repeat(900), retryable: true },
    });

    await service.send(INPUT);

    expect(updates[0].data.failureReason.length).toBeLessThanOrEqual(500);
  });
});

describe('EmailService.alreadySent', () => {
  it('reports a sent delivery as already sent', async () => {
    const { service } = makeService({ existingDelivery: { status: 'SENT' } });
    expect(await service.alreadySent('k')).toBe(true);
  });

  it('lets a previously failed delivery be retried', async () => {
    const { service } = makeService({ existingDelivery: { status: 'FAILED' } });
    expect(await service.alreadySent('k')).toBe(false);
  });

  it('reports an unknown key as not sent', async () => {
    const { service } = makeService({ existingDelivery: null });
    expect(await service.alreadySent('k')).toBe(false);
  });
});

describe('maskEmail', () => {
  it('keeps the domain and the first two characters', () => {
    expect(maskEmail('owner@example.com')).toBe('ow***@example.com');
  });

  it('does not crash on a malformed address', () => {
    expect(maskEmail('not-an-address')).toBe('[invalid address]');
  });
});
