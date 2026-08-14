import { Resend } from 'resend';
import { redactSecrets } from '@/lib/logging/redact';
import type { Mailer, MailerResult, OutboundEmail } from '@/lib/resend/mailer';

/**
 * How long to wait on Resend before giving up.
 *
 * Below Vercel's function ceiling on purpose: losing the race here produces a
 * logged, classified failure, while losing it to the platform produces a killed
 * function and a caller left holding a socket.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ResendMailerOptions {
  readonly timeoutMs?: number;
}

/**
 * The only file in the service that imports the Resend SDK.
 *
 * Two behaviours are worth knowing about:
 *
 *   - **It never throws.** Callers are handling a request that has already
 *     passed authentication and validation; a provider outage is a 500 with a
 *     log line, not an exception unwinding through the route.
 *   - **It never lets the API key escape.** Every message that leaves this
 *     function passes through `redactSecrets` first. Resend does not echo the
 *     key back today, and the cost of being wrong about that once is a live
 *     credential in a log aggregator forever.
 */
export function createResendMailer(apiKey: string, options: ResendMailerOptions = {}): Mailer {
  const client = new Resend(apiKey);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const clean = (message: string) => redactSecrets(message, [apiKey]).slice(0, 500);

  return {
    provider: 'resend',

    async send(email: OutboundEmail): Promise<MailerResult> {
      try {
        const response = await withTimeout(
          client.emails.send({
            from: email.from,
            to: email.to,
            subject: email.subject,
            html: email.html,
            text: email.text,
            attachments: email.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
            })),
          }),
          timeoutMs,
        );

        // The SDK reports provider-side rejections in `error` rather than by
        // throwing, so a resolved promise still has to be checked.
        if (response.error) {
          return {
            ok: false,
            reason: clean(response.error.message ?? 'the provider rejected the message'),
            retryable: isRetryable(response.error.name),
          };
        }

        const id = response.data?.id;
        if (!id) {
          return { ok: false, reason: 'provider returned no message id', retryable: true };
        }

        return { ok: true, id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          reason: clean(message),
          // Network faults and timeouts are transient by nature; the caller is
          // free to try the same report again.
          retryable: true,
        };
      }
    },
  };
}

/**
 * Resend's own error taxonomy, reduced to the one question the caller has.
 *
 * Only used for logging today — the response is a 500 either way — but it is
 * the field a future retry queue reads, and it costs nothing to classify now.
 */
function isRetryable(name: string | undefined): boolean {
  switch (name) {
    case 'rate_limit_exceeded':
    case 'internal_server_error':
    case 'application_error':
      return true;
    default:
      // Validation failures, an unverified domain, a bad key: retrying sends
      // the same request and gets the same answer.
      return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`provider request timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
