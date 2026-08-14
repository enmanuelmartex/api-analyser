# Wiring API Analyser to the relay

This branch contains the relay only. The application side lives on the product
branch; this document describes the contract between them and what the
application does with it.

**Status: implemented.** `apps/api/src/modules/email/transports/relay.transport.ts`
on the product branch posts to `/api/send`, and an install that sets
`MAIL_RELAY_URL` and `MAIL_RELAY_TOKEN` needs no Resend account of its own.

## Why the relay exists

A self-hosted install cannot send branded email on its own. Doing so would mean
every operator creating a Resend account, verifying a domain they do not own,
and holding an API key inside a Docker image that gets cloned and copied around.

So the key lives in exactly one place — a Vercel project that only this branch
deploys — and installs are given a relay token instead. The token can do one
thing: cause a PDF to be emailed to an address. It cannot read anything, cannot
send arbitrary mail, and cannot be used to impersonate the domain, because the
subject, the body and the sender are all fixed on the server.

```
Browser  ──▶  NestJS (local)  ──▶  mail.apianalyser.com  ──▶  Resend  ──▶  inbox
                    │
                    └─ holds MAIL_RELAY_TOKEN, never sends it to the browser
```

The middle hop is not optional. See [CORS](#cors-and-why-the-browser-is-not-a-caller).

## Where it plugs in

`apps/api/src/modules/email/email.service.ts` already describes itself as *"the
only place in the application that knows Resend exists"*, and already owns
idempotency, delivery records and redaction. That is precisely the right seam:
the relay is a second transport behind it, not a second caller of it.

What was built:

1. **A transport interface** in the email module —
   `transports/mail-transport.ts`, one method, `send(message) → TransportResult`.
2. **`ResendTransport`**, the existing direct-to-Resend path moved behind it.
3. **`RelayTransport`**, which posts to `/api/send` and returns the `emailId` as
   the provider message id.
4. **Selection at construction**, in `EmailService.selectTransport`:
   - `RESEND_API_KEY` set → `ResendTransport`. An operator running their own
     Resend account keeps doing so, because setting a provider key is an
     explicit choice to own the delivery path.
   - else `MAIL_RELAY_URL` + `MAIL_RELAY_TOKEN` set → `RelayTransport`.
   - else neither → email disabled, every send recorded `SKIPPED` with a reason.
5. **Nothing else changed.** `EmailService.send` still claims the idempotency
   key before the transport runs, still records `SENT`/`FAILED`, and still emits
   `email.sent` / `email.failed`. Retries stay idempotent because the unique
   index is upstream of the transport, not downstream.

Two constraints the relay imposes, and how they are handled:

- **The relay owns the templates.** It accepts a template name and typed values,
  never HTML. So every message that must be able to travel this way carries a
  `relay: { template, data }` payload alongside the HTML the app rendered for
  the direct path — see `RelayPayload`. A message without one is reported as a
  non-retryable failure naming the problem, rather than being dropped or
  arriving wrong. All three of the app's emails carry one.
- **The relay caps attachments at 3 MB.** `RelayTransport` checks the size
  locally and fails with a clear reason before spending the upload. The app's
  own `EMAIL_MAX_ATTACHMENT_BYTES` (8 MB by default) is the earlier gate: a
  report over that is linked rather than attached, and the email says so. An
  install using the relay should set it to 3 MB or below to keep the two in
  agreement.

## Who receives the mail

Two independent audiences, resolved by `report-recipients.ts` on the app side:

- **Configured addresses** — `notifications.reportRecipients`, editable at
  Settings → Notifications. Usually a team mailbox or a ticketing inbox,
  frequently not users at all. Governed by the install-level switches
  `notifications.emailOnScanCompleted` / `…OnScanFailed`.
- **The project owner's own address** — governed by their own notification
  preferences, exactly as before.

They are independent on purpose: an administrator adding a team mailbox must not
silently start mailing owners who opted out, and one user's preferences must not
suppress an administrator's recipient list. An owner who appears in both gets one
copy, attributed to their user account.

## Environment variables on the API Analyser side

These belong in `apps/api`'s configuration, not here. No real values in Git.

```env
# Base URL of the relay. Unset means "do not use the relay".
MAIL_RELAY_URL=https://mail.apianalyser.com

# The value of the relay's RELAY_SECRET. Server-side only — this must never
# reach the browser, a build artefact, or a committed .env.
MAIL_RELAY_TOKEN=
```

Both are optional. An install that sets neither behaves exactly as it does
today: in-app notifications work, outbound email does not.

## CORS, and why the browser is not a caller

The relay sends no `Access-Control-Allow-Origin` header, so a browser cannot
call it cross-origin. That is deliberate, and it is the reason the NestJS hop
exists rather than a nicety on top of it.

Calling the relay from `apps/web` would mean the token is in browser-reachable
code — readable in devtools, in the JS bundle, and by every script on the page.
One leaked token is an open mail relay for the domain. Without the CORS header,
that mistake fails immediately and visibly in development instead of shipping.

`localhost:3000` and `localhost:4000` therefore need no allowance: neither
originates the request. The NestJS backend does, and CORS is a browser policy
that curl, Node and a Vercel function have never consulted.

If a browser genuinely has to call it one day, the answer is a per-install token
scoped to a single recipient — not `Access-Control-Allow-Origin: *`.

## Large reports

3 MB is the attachment ceiling, and it comes from Vercel's ~4.5 MB request body
limit minus base64's 33% overhead. It is not a number to raise.

The path past it, which the relay is shaped to accept without restructuring:

```
API Analyser local  ──▶  object storage  ──▶  signed URL (short-lived)
                                                    │
                                                    ▼
                                        relay  ──▶  Resend  ──▶  inbox
```

The local install uploads the PDF and posts a URL instead of bytes. The relay
gains a `pdfUrl` field, fetches it, and the rest of the pipeline — auth,
validation, template, provider — is untouched. The only new decisions are which
storage, and whether the relay fetches the URL or forwards it to the recipient
as a download link.

Nothing here implements that. There is no blob storage in the project yet, and
adding one to serve a limit that few reports reach would be building for a
problem that has not arrived.
