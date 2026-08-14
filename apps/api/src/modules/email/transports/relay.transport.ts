import type {
  MailTransport,
  OutboundMessage,
  TransportResult,
} from './mail-transport';

/** Matches the relay's own attachment ceiling. Checked here so an oversized
 *  report fails locally with a clear reason instead of after a 4 MB upload. */
export const RELAY_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 30_000;

interface RelayResponseBody {
  success?: boolean;
  emailId?: string;
  error?: string;
}

/**
 * Sends through the hosted API Analyser mail relay.
 *
 * The point of the indirection: a self-hosted install gets branded email from a
 * verified domain without its operator creating a Resend account, verifying a
 * domain they do not own, or keeping an API key inside an image that gets
 * cloned around. The install holds one relay token instead, and that token can
 * only cause one of three known messages to be sent.
 *
 * Which is the constraint that shapes this class: the relay renders its own
 * templates and refuses HTML, so a message without a `relay` payload cannot go
 * this way. That is reported as a non-retryable failure with a reason naming
 * the template, rather than being silently dropped — a message that cannot be
 * sent should say so once, loudly, not disappear.
 */
export class RelayTransport implements MailTransport {
  readonly name = 'relay';

  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async send(message: OutboundMessage): Promise<TransportResult> {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'The mail relay is not configured.', retryable: false };
    }

    if (!message.relay) {
      return {
        ok: false,
        reason:
          'This message has no relay template. The relay renders its own templates and ' +
          'does not accept HTML; add a relay payload to send it this way, or configure ' +
          'RESEND_API_KEY to send directly.',
        retryable: false,
      };
    }

    const attachment = message.attachments?.[0];
    if (attachment && attachment.content.length > RELAY_MAX_ATTACHMENT_BYTES) {
      const mb = (RELAY_MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
      return {
        ok: false,
        reason: `The report exceeds the relay's ${mb}MB attachment limit.`,
        retryable: false,
      };
    }

    // Only `scan-report` may carry one; the relay rejects an attachment on the
    // other templates, and sending one would earn a 400 rather than an email.
    const body = {
      to: message.to,
      ...message.relay,
      ...(attachment && message.relay.template === 'scan-report'
        ? {
            attachment: {
              filename: attachment.filename,
              contentBase64: attachment.content.toString('base64'),
            },
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // DNS, TLS, timeout: the relay was never reached, so the message was
      // certainly not sent and retrying is safe.
      return {
        ok: false,
        reason: this.redact(`The mail relay is unreachable: ${(error as Error).message}`),
        retryable: true,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as RelayResponseBody;

    if (!response.ok || !payload.success) {
      return {
        ok: false,
        reason: this.redact(
          payload.error
            ? `The mail relay refused the message (${response.status}): ${payload.error}`
            : `The mail relay returned ${response.status}.`,
        ),
        // 429 and 5xx are worth another attempt; 400/401/413 will fail
        // identically until the payload or the configuration changes.
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    return { ok: true, providerMessageId: payload.emailId };
  }

  /**
   * Strips the relay token from anything on its way to a log or a delivery row.
   *
   * The relay never echoes it — but this text includes a message we did not
   * write, and a token in a database column is as bad as a key in a log.
   */
  private redact(message: string): string {
    if (!this.token || this.token.length < 8) return message;
    return message.split(this.token).join('[redacted]');
  }
}
