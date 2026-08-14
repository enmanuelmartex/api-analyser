/**
 * The provider boundary.
 *
 * Everything above this line — the route, validation, the template — speaks in
 * terms of `Mailer` and never imports the Resend SDK. That is what lets the
 * tests run without a network, without an API key, and with a certainty that no
 * real email can be sent: they pass a different `Mailer`, and there is no other
 * path to a provider.
 */

export interface OutboundAttachment {
  readonly filename: string;
  readonly content: Buffer;
}

export interface OutboundEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments: readonly OutboundAttachment[];
}

export type MailerResult =
  | { readonly ok: true; readonly id: string }
  /**
   * `reason` is already redacted by the implementation and is safe to log. It
   * is still never returned to the caller — provider text can name internals,
   * and the caller gets the single generic failure message instead.
   */
  | { readonly ok: false; readonly reason: string; readonly retryable: boolean };

export interface Mailer {
  /** For logs. */
  readonly provider: string;
  /** Never throws: every outcome is a returned value. */
  send(email: OutboundEmail): Promise<MailerResult>;
}
