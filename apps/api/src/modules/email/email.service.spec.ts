import { describe, expect, it, mock } from 'bun:test';
import { EmailService, maskEmail } from './email.service';

/**
 * Delivery idempotency, and the rules about what must never leave this service.
 *
 * The important one is the duplicate guard: jobs retry, events are redelivered,
 * and "Report ready" arriving three times for one report is the failure mode the
 * unique `idempotencyKey` exists to prevent.
 */

const UNIQUE_VIOLATION = 'P2002';
const API_KEY = 're_test_secretkey123';

interface Options {
  configured?: boolean;
  /** Simulates the key already being claimed, as a concurrent send would. */
  keyTaken?: boolean;
  /** Resend returning a rejection in `error` rather than throwing. */
  providerError?: string;
  /** The SDK throwing outright — a network failure. */
  throws?: string;
  existingDelivery?: { status: string } | null;
}

function makeService(options: Options = {}) {
  const configured = options.configured !== false;
  const rows: any[] = [];
  const updates: { id: string; data: any }[] = [];
  const emitted: { event: string; payload: any }[] = [];
  const sends: any[] = [];

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
        'email.apiKey': configured ? API_KEY : '',
        'email.fromEmail': 'security@example.com',
        'email.fromName': 'API Analyzer',
      })[key],
  };

  const events = {
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
      return true;
    },
  };

  const service = new EmailService(prisma as any, config as any, events as any);

  // The Resend client is constructed in the constructor; replace its send with
  // a fake rather than reaching the network.
  if (configured) {
    (service as any).client = {
      emails: {
        send: async (payload: any) => {
          sends.push(payload);
          if (options.throws) throw new Error(options.throws);
          if (options.providerError) return { error: { message: options.providerError }, data: null };
          return { error: null, data: { id: 'resend_msg_1' } };
        },
      },
    };
  }

  return { service, rows, updates, emitted, sends };
}

const INPUT = {
  idempotencyKey: 'report-ready:report_1:user_1',
  userId: 'user_1',
  to: 'owner@example.com',
  subject: 'Scan complete — Production API',
  html: '<p>done</p>',
  text: 'done',
  template: 'report-ready',
  entityType: 'report',
  entityId: 'report_1',
};

describe('EmailService.send', () => {
  it('sends the message and records the delivery as SENT', async () => {
    const { service, rows, updates, emitted, sends } = makeService();

    const result = await service.send(INPUT);

    expect(result.status).toBe('SENT');
    expect(sends).toHaveLength(1);
    expect(sends[0].from).toBe('API Analyzer <security@example.com>');

    // The row is claimed BEFORE the provider is called, which is what makes a
    // concurrent second send lose the race rather than duplicate the message.
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].idempotencyKey).toBe(INPUT.idempotencyKey);

    expect(updates[0].data.status).toBe('SENT');
    expect(updates[0].data.providerMessageId).toBe('resend_msg_1');
    expect(emitted[0].event).toBe('email.sent');
  });

  /**
   * The duplicate-email test.
   *
   * A retried job presents the same idempotency key. The insert loses, and the
   * provider must not be called at all.
   */
  it('does not send twice for the same idempotency key', async () => {
    const { service, sends, emitted } = makeService({ keyTaken: true });

    const result = await service.send(INPUT);

    expect(result.status).toBe('SKIPPED');
    expect(sends).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('skips, rather than fails, when no provider is configured', async () => {
    const { service, rows, sends } = makeService({ configured: false });

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

  it('records a provider rejection as FAILED and never throws', async () => {
    const { service, updates, emitted } = makeService({ providerError: 'Domain not verified' });

    const result = await service.send(INPUT);

    expect(result.status).toBe('FAILED');
    expect(updates[0].data.status).toBe('FAILED');
    expect(updates[0].data.failureReason).toBe('Domain not verified');
    expect(emitted[0].event).toBe('email.failed');
  });

  it('records a transport error as FAILED and never throws', async () => {
    const { service, updates } = makeService({ throws: 'socket hang up' });

    const result = await service.send(INPUT);

    expect(result.status).toBe('FAILED');
    expect(updates[0].data.failureReason).toBe('socket hang up');
  });

  /**
   * The API key must not survive a round trip through an error message into the
   * database, the logs, or the caller.
   */
  it('redacts the API key from a provider error', async () => {
    const { service, updates } = makeService({
      providerError: `Request failed with key ${API_KEY}`,
    });

    const result = await service.send(INPUT);

    expect(result.status).toBe('FAILED');
    expect(updates[0].data.failureReason).not.toContain(API_KEY);
    expect(updates[0].data.failureReason).toContain('[redacted]');
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
