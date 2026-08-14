import { Resend } from 'resend';
import type {
  MailTransport,
  OutboundMessage,
  TransportResult,
} from './mail-transport';

/**
 * Sends directly through Resend, using this installation's own API key.
 *
 * For an operator who runs their own Resend account and wants full control of
 * the sending domain and the templates. It is preferred over the relay when
 * `RESEND_API_KEY` is set, because setting it is an explicit choice to own the
 * delivery path.
 *
 * The one invariant: the API key never escapes. Every message that leaves this
 * class passes through `redact` first. Resend does not echo the key back today,
 * and the cost of being wrong about that once is a live credential in a log
 * aggregator forever.
 */
export class ResendTransport implements MailTransport {
  readonly name = 'resend';

  private readonly client: Resend | null;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(message: OutboundMessage): Promise<TransportResult> {
    if (!this.client) {
      return { ok: false, reason: 'No Resend API key is configured.', retryable: false };
    }

    try {
      const response = await this.client.emails.send({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
        })),
      });

      // The SDK reports provider-side rejections in `error` rather than by
      // throwing, so a resolved promise still has to be checked.
      if (response.error) {
        return {
          ok: false,
          reason: this.redact(response.error.message ?? 'The provider rejected the message.'),
          retryable: isRetryable(response.error.name),
        };
      }

      return { ok: true, providerMessageId: response.data?.id };
    } catch (error) {
      return {
        ok: false,
        reason: this.redact((error as Error).message),
        // Network faults and timeouts are transient by nature.
        retryable: true,
      };
    }
  }

  private redact(message: string): string {
    if (!this.apiKey) return message;
    return message.split(this.apiKey).join('[redacted]');
  }
}

/**
 * Resend's error taxonomy reduced to the one question the caller has.
 *
 * A validation failure, an unverified domain or a bad key all produce the same
 * answer on a retry, so retrying only burns queue attempts.
 */
function isRetryable(name: string | undefined): boolean {
  switch (name) {
    case 'rate_limit_exceeded':
    case 'internal_server_error':
    case 'application_error':
      return true;
    default:
      return false;
  }
}
