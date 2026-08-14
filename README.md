# API Analyser — mail relay

A single-purpose service that emails a security report. It exists so a
self-hosted API Analyser install can send branded mail from a verified domain
without its operator ever holding a Resend API key.

```
API Analyser (local)
        │  HTTPS POST /api/send   (Authorization: Bearer …)
        ▼
mail.apianalyser.com                     ← this branch, a Vercel project
        │  Resend SDK
        ▼
reports@notifications.apianalyser.com
        │
        ▼
recipient's inbox, with the PDF attached
```

No UI, no database, no dashboard. Three endpoints and about nine hundred lines of
library code, which is small enough to read end to end before trusting it with a
credential.

> **Branch.** This lives on `mail-service`, an orphan branch with no shared
> history with `main` or `landing`. It is deployed as its own Vercel project.
> Do not merge it into `main`.

---

## Endpoints

### `POST /api/send`

The endpoint API Analyser uses. Requires `Authorization: Bearer <RELAY_SECRET>`.

A caller names a **template** and supplies typed values for it. It cannot supply
markup, a subject or a sender — that is the property that keeps a service
sending from a verified security domain from being a phishing tool.

```json
{
  "to": "security@example.com",
  "template": "scan-report",
  "data": {
    "projectName": "Production API",
    "securityScore": 72,
    "counts": { "critical": 1, "high": 3, "medium": 2, "low": 5, "info": 0 },
    "totalFindings": 11,
    "reportUrl": "https://analyser.internal/reports/abc123"
  },
  "attachment": { "filename": "security-report.pdf", "contentBase64": "JVBERi0…" }
}
```

| Template | `data` fields | Attachment |
| -------- | ------------- | ---------- |
| `scan-report` | `projectName` (req), `securityScore`, `counts`, `totalFindings`, `reportUrl` | optional PDF |
| `scan-failed` | `projectName` (req), `reason` (req), `scanUrl`, `scheduleName` | rejected |
| `critical-finding` | `projectName` (req), `criticalCount` (req), `issuesUrl` | rejected |

URLs must be `http`/`https`; anything else is a `400`. Every link is rendered
with its destination printed in visible text underneath, because a recipient on
a phone cannot hover a button to see where it goes.

Responses are identical to `/api/send-report` below.

### `POST /api/send-report`

The minimal form — a recipient, a name and a PDF — kept for shell scripts and
first integrations. It renders the same `scan-report` template as `/api/send`,
so the two cannot drift into two different-looking emails.

Requires `Authorization: Bearer <RELAY_SECRET>`.

```json
{
  "email": "user@example.com",
  "scanName": "Production API",
  "filename": "security-report.pdf",
  "pdfBase64": "JVBERi0xLjcK…"
}
```

| Field       | Required | Rules |
| ----------- | -------- | ----- |
| `email`     | yes      | A valid address, ≤ 320 chars, no line breaks |
| `filename`  | yes      | Must end in `.pdf`; sanitised server-side |
| `pdfBase64` | yes      | Valid base64 of a real PDF, ≤ 3 MB decoded |
| `scanName`  | no       | ≤ 200 chars, no line breaks. Absent ⇒ generic subject |

Unknown fields are **rejected**, not ignored. In particular there is no way to
supply HTML, a subject, or a sender: the template is entirely server-owned, and
that is what stops the relay from becoming a phishing service.

**Success — `200`**

```json
{ "success": true, "message": "Report email sent", "emailId": "4ef9…" }
```

**Failure**

| Status | When |
| ------ | ---- |
| `400`  | Invalid JSON, failed validation, bad base64, not a PDF, non-`.pdf` filename |
| `401`  | Missing, malformed or incorrect bearer token |
| `413`  | PDF over 3 MB, or request body over 4.5 MB |
| `429`  | Rate limit exceeded (includes `Retry-After`) |
| `500`  | Provider failure, missing configuration, or an unexpected error |

```json
{ "success": false, "error": "Unable to send report email" }
```

Error bodies never contain a stack trace, a provider message, an environment
variable, or the submitted values.

### `GET /api/health`

Unauthenticated liveness probe.

```json
{ "status": "ok", "service": "api-analyzer-mail-relay" }
```

Two constant strings, by design — it reveals nothing about configuration,
version or provider reachability. An authenticated health check tells you
nothing when the thing that broke is authentication.

---

## Development

The repository uses **bun** (`bun.lock`, and `bun test` across `apps/api`), so
that is what these instructions use. Every command has an npm equivalent if you
prefer — `npm install`, `npm run dev`, and `npx vitest` in place of `bun test`.

```bash
bun install
```

Create `.env.local` — it is git-ignored, and it is the only place a real secret
belongs on your machine:

```bash
cp .env.example .env.local
```

Then fill it in:

```env
RESEND_API_KEY=re_…                 # https://resend.com/api-keys
RELAY_SECRET=…                      # openssl rand -base64 48
EMAIL_FROM="API Analyzer <reports@notifications.apianalyser.com>"
```

```bash
bun run dev          # http://localhost:3000
bun test             # 192 tests, no network, no real email
bun run lint
bun run type-check
bun run build        # what Vercel runs
```

### Required environment variables

| Variable         | Required | Purpose |
| ---------------- | -------- | ------- |
| `RESEND_API_KEY` | **yes**  | Authenticates to Resend. Never logged, never returned, never in Git. |
| `RELAY_SECRET`   | **yes**  | The bearer token callers must present. Also never in Git. |
| `EMAIL_FROM`     | no       | Sender. Defaults to `API Analyzer <reports@notifications.apianalyser.com>`. |

`RELAY_SECRET` is required rather than optional on purpose: an unset secret is
never treated as "no authentication needed". The service refuses to serve at all
instead, because the alternative is an open mail relay.

With either required variable missing, both endpoints stay up, `/api/health`
still answers, and `/api/send-report` returns `500` with `Mail relay is not
configured` while the log names the missing variable — never its value.

### Optional environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `UPSTASH_REDIS_REST_URL` | — | Enables the distributed rate limiter (needs the token too) |
| `UPSTASH_REDIS_REST_TOKEN` | — | " |
| `RATE_LIMIT_MAX` | `20` | Requests allowed per window |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Window length |

---

## Testing it

Health check — no credentials needed:

```bash
curl https://mail.apianalyser.com/api/health
```

A real send, using the script in [`examples/`](examples/send-report.sh) so the
token and the multi-megabyte body never appear as command-line arguments:

```bash
export MAIL_RELAY_URL=https://mail.apianalyser.com
export MAIL_RELAY_TOKEN=…            # the value of RELAY_SECRET
./examples/send-report.sh you@example.com ./report.pdf "Production API"
```

Confirm the rejections work, which is the more interesting half:

```bash
# 401 — no token
curl -i -X POST "$MAIL_RELAY_URL/api/send-report" \
  -H 'Content-Type: application/json' -d '{}'

# 400 — invalid email
curl -i -X POST "$MAIL_RELAY_URL/api/send-report" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAIL_RELAY_TOKEN" \
  -d '{"email":"nope","filename":"r.pdf","pdfBase64":"JVBERi0="}'
```

The automated suite covers all of this and never touches the network: the
handler reaches a provider only through a `Mailer` interface, and every test
passes a fake. There is no un-mocked path to Resend to forget about.

---

## Limits

**3 MB per PDF**, decoded — roughly 4 MB of base64 on the wire.

The number comes from the platform: a Vercel function receives at most ~4.5 MB
of request body, and base64 costs 4 bytes per 3. Over the limit, the relay
returns `413` — from `Content-Length` where possible, before the body is read at
all.

Larger reports are a real case, and the answer is not a bigger number. The
intended path, which the code is shaped to accept without restructuring, is
described in [`docs/INTEGRATION.md`](docs/INTEGRATION.md#large-reports): the
local install uploads to object storage and posts a short-lived URL instead of
bytes. Nothing here implements that — the project has no blob storage yet, and
building one for a limit few reports reach would be premature.

## Rate limiting

Default **20 requests per 60 seconds per credential**, returning `429` with a
`Retry-After` header.

Out of the box this uses an in-memory counter, which is honest about being
best-effort on serverless: each Vercel instance has its own heap, so the real
ceiling is `limit × instances` and a cold start resets it. It is still a floor
that stops one runaway loop from emptying a Resend quota.

For a real limit, create an Upstash Redis database and set both variables in the
Vercel project:

```env
UPSTASH_REDIS_REST_URL=https://….upstash.io
UPSTASH_REDIS_REST_TOKEN=…
```

No code change and no redeploy of the source — the next invocation picks it up
and the counter becomes shared. The implementation is
[`lib/rate-limit/upstash-rate-limiter.ts`](lib/rate-limit/upstash-rate-limiter.ts),
written against `fetch` rather than a client library, and **Vercel KV speaks the
same REST protocol, so it works unchanged**. Any other store is one file
implementing the three-member `RateLimiter` interface plus a branch in
[`lib/rate-limit/index.ts`](lib/rate-limit/index.ts).

The limiter keys on `AuthContext.clientId`. Today that is a constant, so the
limit is global; when per-install tokens land it becomes the installation id and
the same limiter is per-install with no further change.

---

## Security notes

- **No open relay.** Every send requires a bearer token, compared in constant
  time against SHA-256 digests of both sides — so a wrong token leaks neither
  its correctness nor the secret's length through timing.
- **Nothing about the failure is disclosed.** A missing token and a wrong token
  produce byte-identical responses. The distinction goes to the log.
- **The template is server-owned.** No caller-supplied HTML, subject or sender,
  and unknown fields are rejected rather than dropped. Scan names and filenames
  are HTML-escaped; line breaks are refused everywhere that reaches a mail
  header, which is what blocks `Bcc:` injection through a scan name.
- **Attachments are verified.** Base64 alphabet and padding are checked before
  decoding — `Buffer.from` silently skips invalid characters, so without that
  check a caller gets a corrupt attachment instead of a `400` — and the decoded
  bytes must actually begin with `%PDF-`.
- **Filenames are sanitised** against an allow-list: path segments, traversal,
  control characters and the RTL override used to disguise extensions all go.
- **Secrets are never logged.** Two independent guards: call sites do not pass
  them, and every log payload is filtered by
  [`lib/logging/redact.ts`](lib/logging/redact.ts) on the way out. Provider
  error text is scrubbed of the API key before it is written anywhere. Recipient
  addresses are masked to `se****@example.com`.
- **No CORS headers.** A browser cannot call this cross-origin, which is
  deliberate — the token must never reach one. See
  [`docs/INTEGRATION.md`](docs/INTEGRATION.md#cors-and-why-the-browser-is-not-a-caller).

Secrets exist in exactly two places: your local `.env.local`, and the Vercel
project's environment variables. Not in this repository, not in the Docker
image, not in the local application, and not in any file here.

---

## Deploying to Vercel

1. **Vercel → Add New → Project**, and select this repository.
2. **Settings → Git → Production Branch**: set it to `mail-service`.
   Vercel defaults to `main`, which would deploy the wrong application entirely.
3. **Root Directory**: leave as `./`. The app is at the root of this branch.
   Framework preset is detected as Next.js (and pinned in `vercel.json`).
4. **Settings → Environment Variables**, for the Production environment:

   | Name | Value |
   | ---- | ----- |
   | `RESEND_API_KEY` | your Resend key |
   | `RELAY_SECRET` | `openssl rand -base64 48` |
   | `EMAIL_FROM` | `API Analyzer <reports@notifications.apianalyser.com>` |

5. **Deploy.**
6. **Settings → Domains**: add `mail.apianalyser.com` and create the CNAME
   Vercel shows you.
7. **Verify liveness**: `curl https://mail.apianalyser.com/api/health` →
   `{"status":"ok","service":"api-analyzer-mail-relay"}`.
8. **Verify a real send**, with `examples/send-report.sh`. Then check the
   Resend dashboard for the delivery, and the Vercel function logs for an
   `email.sent` line — it should contain a masked recipient and no secret.

Optionally, add the Upstash variables from [Rate limiting](#rate-limiting) to
make the limit real rather than per-instance.

---

## Layout

Routing, authentication, validation, templating and the provider are separate on
purpose: each can be replaced without touching the others, and the tests hold
them apart.

```
app/api/
  health/route.ts            liveness, two constant strings
  send-report/route.ts       runtime config; delegates immediately

lib/
  relay/
    send-report-handler.ts   the endpoint's actual logic, dependency-injected
    dependencies.ts          builds the real ones once per warm instance
  auth/
    authenticator.ts         the interface everything else depends on
    shared-secret.ts         today's implementation: one bearer token
    bearer.ts                header parsing, constant-time compare
    index.ts                 the factory — and how to grow past one secret
  validation/
    send-report.schema.ts    Zod, strict: unknown fields are rejected
    pdf.ts                   base64 → Buffer, with the checks that matter
    filename.ts              allow-list sanitiser
  email/
    report-email.ts          the server-owned template (HTML + text)
    escape.ts
  resend/
    mailer.ts                the provider boundary — the tests' seam
    resend-mailer.ts         the only file that imports the Resend SDK
  rate-limit/               interface + in-memory + Upstash, chosen by env
  logging/                  structured logs, and the redaction that guards them
  http/                     error taxonomy and response envelopes
  config/env.ts             the only reader of process.env
  limits.ts                 every size ceiling, in one place

tests/                      192 tests; Resend is a fake, never the real client
examples/                   client code to copy into API Analyser
docs/INTEGRATION.md         how the local app will call this
```

Authentication is deliberately not entangled with the endpoint. Swapping the
shared secret for per-install, revocable tokens with their own rate limits is a
new `Authenticator` and one line in `lib/auth/index.ts`; the route, the
validation and the Resend call are untouched. The design notes for that are in
[`lib/auth/index.ts`](lib/auth/index.ts).
