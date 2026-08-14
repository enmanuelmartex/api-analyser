# Wiring API Analyser to the relay

This branch contains the relay only. Nothing on `main` calls it yet, and nothing
here modifies `main`. This document is the plan for when it does.

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
Browser  ──▶  NestJS (local)  ──▶  relay.apianalyser.com  ──▶  Resend  ──▶  inbox
                    │
                    └─ holds MAIL_RELAY_TOKEN, never sends it to the browser
```

The middle hop is not optional. See [CORS](#cors-and-why-the-browser-is-not-a-caller).

## Where it plugs in

`apps/api/src/modules/email/email.service.ts` already describes itself as *"the
only place in the application that knows Resend exists"*, and already owns
idempotency, delivery records and redaction. That is precisely the right seam:
the relay is a second transport behind it, not a second caller of it.

The shape of the change, when it is made:

1. **Add a transport interface** in the email module — one method, `send(message)
   → { providerMessageId }` — and move the existing `Resend` call behind it as
   `ResendTransport`.
2. **Add `RelayTransport`**, built from the client in
   [`examples/mail-relay.client.ts`](../examples/mail-relay.client.ts). It posts
   to `/api/send-report` and returns the `emailId` as the provider message id.
3. **Select one at construction**, in the module or in `configuration.ts`:
   - `RESEND_API_KEY` set → `ResendTransport` (an operator running their own
     Resend account keeps doing so, and keeps full control of the template).
   - else `MAIL_RELAY_URL` + `MAIL_RELAY_TOKEN` set → `RelayTransport`.
   - else neither → the existing "email disabled" path, unchanged.
4. **Change nothing else.** `EmailService.send` keeps claiming the idempotency
   key before the transport runs, keeps recording `SENT`/`FAILED`, and keeps
   emitting `email.sent` / `email.failed`. Retries stay idempotent because the
   unique index is upstream of the transport, not downstream.

Two constraints the relay imposes on that work:

- **The relay owns the template.** `RelayTransport` cannot send the HTML that
  `EmailService` renders for other templates — the relay accepts a scan name and
  a PDF, and builds the body itself. So `RelayTransport` is only valid for the
  report email. Every other template needs `ResendTransport`, or a new relay
  endpoint. Route on `input.template` and fail loudly on the ones it cannot
  handle rather than silently sending the wrong thing.
- **The relay caps attachments at 3 MB.** `EmailService` should check the PDF
  size before it calls the transport, and record a `SKIPPED` delivery with a
  clear reason rather than a `FAILED` one — a 12 MB report is not a fault, and
  the report itself is still downloadable in the UI.

## Environment variables on the API Analyser side

These belong in `apps/api`'s configuration, not here. No real values in Git.

```env
# Base URL of the relay. Unset means "do not use the relay".
MAIL_RELAY_URL=https://relay.apianalyser.com

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
