/**
 * Example client — copy this into API Analyser, do not import it from here.
 *
 * This file is documentation that happens to compile. It lives on the
 * `mail-service` branch so the request shape has exactly one definition, and it
 * is written to be pasted into `apps/api/src/modules/email/` on `main` with the
 * imports swapped for that app's own.
 *
 * See `docs/INTEGRATION.md` for where it plugs in.
 */

export interface SendReportEmailInput {
  /** Recipient. The relay validates it again; validate it locally too. */
  email: string;
  /** Optional. Becomes `Security Report - {scanName}` in the subject. */
  scanName?: string;
  /** Must end in `.pdf`. The relay sanitises it. */
  filename: string;
  /** The report itself. Base64, no data-URL prefix needed. */
  pdfBase64: string;
}

export interface MailRelayResult {
  success: boolean;
  message?: string;
  emailId?: string;
  error?: string;
}

export class MailRelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Whether sending the same report again could plausibly work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MailRelayError';
  }
}

/** Matches the relay's own ceiling; see its README → Limits. */
export const MAX_REPORT_BYTES = 3 * 1024 * 1024;

export interface MailRelayClientOptions {
  /** e.g. `https://mail.apianalyser.com` — from `MAIL_RELAY_URL`. */
  baseUrl: string;
  /** From `MAIL_RELAY_TOKEN`. Never log it, never send it to a browser. */
  token: string;
  timeoutMs?: number;
}

/**
 * Posts a generated report to the relay, which sends it through Resend.
 *
 * The point of the indirection: a self-hosted install gets branded email from a
 * verified domain without its operator obtaining a Resend account, verifying a
 * domain, or holding an API key. The install holds one relay token instead, and
 * the token can only do this one thing.
 */
export class MailRelayClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: MailRelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async sendReport(input: SendReportEmailInput): Promise<{ emailId: string }> {
    // Check locally before spending a few megabytes of upload discovering the
    // relay would have said 413.
    const approximateBytes = Math.floor((input.pdfBase64.length * 3) / 4);
    if (approximateBytes > MAX_REPORT_BYTES) {
      throw new MailRelayError(
        413,
        `Report is ${(approximateBytes / 1024 / 1024).toFixed(1)} MB; the relay accepts 3 MB.`,
        false,
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/send-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          email: input.email,
          scanName: input.scanName,
          filename: input.filename,
          pdfBase64: input.pdfBase64,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // DNS, TLS, timeout: the relay was never reached, so the report was
      // certainly not sent and retrying is safe.
      throw new MailRelayError(
        0,
        `Mail relay unreachable: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const body = (await response.json().catch(() => ({}))) as MailRelayResult;

    if (!response.ok || !body.success) {
      throw new MailRelayError(
        response.status,
        body.error ?? `Mail relay returned ${response.status}`,
        // 429 and 5xx are worth another attempt; 400/401/413 will fail
        // identically forever until the caller or the config changes.
        response.status === 429 || response.status >= 500,
      );
    }

    return { emailId: body.emailId ?? '' };
  }

  /** Cheap liveness probe. Unauthenticated on the relay's side. */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * How it is wired up in practice, from a queue worker that has just written a
 * report to disk.
 *
 * Note what is *not* here: no retry loop around a 400, no logging of the
 * recipient in full, and no failure propagated to the caller. A report that
 * exists and is downloadable should not be marked failed because a mail
 * provider was briefly unhappy.
 */
export async function exampleUsage(): Promise<void> {
  const baseUrl = process.env.MAIL_RELAY_URL;
  const token = process.env.MAIL_RELAY_TOKEN;

  // Email is an optional feature of a self-hosted install. Unconfigured is a
  // normal state, not an error.
  if (!baseUrl || !token) return;

  const client = new MailRelayClient({ baseUrl, token });

  const pdfBase64 = (await readReportFromDisk()).toString('base64');

  try {
    const { emailId } = await client.sendReport({
      email: 'security@example.com',
      scanName: 'Production API',
      filename: 'security-report.pdf',
      pdfBase64,
    });
    console.log(`[Email] Report sent via relay (${emailId})`);
  } catch (error) {
    if (error instanceof MailRelayError) {
      console.error(`[Email] Relay refused the report (${error.status}): ${error.message}`);
      if (error.retryable) {
        // Hand it back to the queue rather than dropping it.
      }
      return;
    }
    throw error;
  }
}

/** Stand-in for the real report reader. */
async function readReportFromDisk(): Promise<Buffer> {
  return Buffer.from('%PDF-1.7\n');
}
