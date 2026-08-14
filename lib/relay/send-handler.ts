import { renderTemplate } from '@/lib/email/templates';
import type { RelayDependencies } from '@/lib/relay/dependencies';
import { deliver, runRelayRequest } from '@/lib/relay/pipeline';
import type { OutboundAttachment } from '@/lib/resend/mailer';
import { sanitiseFilename } from '@/lib/validation/filename';
import { decodePdfBase64 } from '@/lib/validation/pdf';
import { parseSendRequest } from '@/lib/validation/send.schema';

/**
 * `POST /api/send` — the endpoint API Analyser uses.
 *
 * The difference from `/api/send-report` is what the caller may say, not what
 * it may render: a template *name* plus typed values for it, rather than one
 * fixed message. A caller still cannot supply markup, a subject or a sender,
 * which is the property that keeps a relay sending from a verified security
 * domain from being a phishing service.
 */
export async function handleSend(
  request: Request,
  injected?: RelayDependencies,
): Promise<Response> {
  return runRelayRequest(request, injected, async (body, context) => {
    const payload = parseSendRequest(body);

    let attachments: OutboundAttachment[] | undefined;
    let attachedFilename: string | undefined;

    if (payload.template === 'scan-report' && payload.attachment) {
      attachedFilename = sanitiseFilename(payload.attachment.filename);
      attachments = [
        { filename: attachedFilename, content: decodePdfBase64(payload.attachment.contentBase64) },
      ];
    }

    const rendered =
      payload.template === 'scan-report'
        ? renderTemplate({ template: 'scan-report', data: payload.data, attachedFilename })
        : renderTemplate(payload);

    return deliver(context, {
      to: payload.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments,
      template: payload.template,
    });
  });
}
