# Automatic Reports, Notifications and Email

Three features that are really one pipeline: a scan finishes, its PDF is
generated, the user is told, and — if they asked for it — emailed.

---

## The pipeline

```
Scan worker finishes
        │
        ├─ persists findings, computes the score
        │
        └─ emits  scan.completed  ─────────────────┬───────────────┬──────────────┐
                                                   │               │              │
                                          ReportsAutoListener  NotificationsListener  AuditEventsListener
                                                   │               │              │
                                          claims the PDF     SCAN_COMPLETED     audit row
                                          (status PENDING)   NEW_FINDINGS
                                                   │         CRITICAL_FINDING
                                            reports queue
                                                   │
                                          ReportsProcessor
                                          renders (Chromium)
                                                   │
                              ┌────────────────────┴────────────────────┐
                              │                                          │
                     bytes written to disk                    every retry exhausted
                     status COMPLETED                          status FAILED
                              │                                          │
                     emits report.generated                   emits report.failed
                        ╱          ╲                                     │
             NotificationsListener  EmailListener              REPORT_FAILED notification
             REPORT_GENERATED       │                          + audit row
                                 email queue
                                    │
                             EmailProcessor
                             reads preferences, attaches the STORED pdf
                                    │
                              EmailService → Resend
                                    │
                        emits email.sent / email.failed
                                    │
                        EMAIL_REPORT_SENT / EMAIL_REPORT_FAILED
```

Nothing in this chain calls the next stage directly. Each step emits an event
and returns; the consumers are independent and none knows the others exist. That
is what makes a scheduled scan behave identically to a manual one — **both end
by emitting `scan.completed`, and everything after that is shared**.

---

## The guarantees, and what enforces them

| Guarantee | Enforced by |
|---|---|
| Exactly one automatic PDF per scan | `reports.autoKey` — a unique column holding the assessment id. A redelivered `scan.completed` loses the insert race with `P2002` and enqueues nothing. |
| A report is never announced before it exists | `report.generated` is emitted *after* the row reaches `COMPLETED`, by `AutoReportService.markCompleted`. The email listener subscribes to that event, never to `scan.completed`. |
| A failed render is never recorded as success | `materialise(…, { strict: true })` on the queue path. The lenient fallback that keeps an HTML snapshot is used only by the synchronous export API. |
| PDF failures are retried, then surfaced | 3 attempts, exponential backoff from 5 s. The final failure writes `status = FAILED`, an audit row, and a `REPORT_FAILED` notification. |
| No duplicate emails | `email_deliveries.idempotencyKey` is unique, and the row is claimed *before* the provider is called. |
| One notification per scan, not one per finding | `NEW_FINDINGS` carries the severity breakdown in its message. |
| Notifications are private | Every query and mutation is filtered by the authenticated `user.id` in the service. No endpoint accepts a `userId` parameter. |
| Nothing is lost while you are offline | Every notification is a database row before it is streamed. SSE is an optimisation; the counts come from the same query on the next page load. |

---

## Notification types

Adding one is two edits: the `NotificationType` enum in `schema.prisma`, and one
entry in [`notification-catalog.ts`](../apps/api/src/modules/notifications/notification-catalog.ts).
The catalog is typed `Record<NotificationType, NotificationDefinition>`, so a
type added without an entry **fails the build**.

| Type | Category | Emailed? |
|---|---|---|
| `SCAN_COMPLETED` / `SCHEDULED_SCAN_COMPLETED` | SCANS | yes |
| `SCAN_FAILED` / `SCHEDULED_SCAN_FAILED` | SCANS | yes |
| `REPORT_GENERATED` | REPORTS | yes |
| `REPORT_FAILED` | REPORTS | no — it is retried automatically |
| `NEW_FINDINGS` | ISSUES | no — the scan email already carries the breakdown |
| `CRITICAL_FINDING` | ISSUES | yes |
| `EMAIL_REPORT_SENT` / `EMAIL_REPORT_FAILED` | REPORTS | no — mailing about mail is a loop |
| `SECURITY_WARNING` | SECURITY | no |
| `SYSTEM_ERROR` | SYSTEM | no |

`ISSUES` is separate from `SECURITY` deliberately: ISSUES means "this scan found
vulnerabilities in your API" and badges the Issues screen, while SECURITY means
"something happened to this installation" and belongs to an administrator.

---

## Badges

The sidebar badges, the header bell and the notification centre all read one
endpoint, `GET /notifications/summary`, through one React Query key. Giving each
its own request is how they end up disagreeing.

```json
{ "totalUnread": 9, "byCategory": { "SCANS": 2, "ISSUES": 5, "REPORTS": 2 },
  "scans": 2, "issues": 5, "reports": 2 }
```

`totalUnread` counts every category, including SECURITY and SYSTEM, which have
no sidebar entry — they must still raise the bell.

**"Seen" means you opened the section.** Visiting `/issues` calls
`POST /notifications/sections/issues/read`, which flips `read` and stamps
`readAt` for that category only. Nothing is deleted, so the history stays in the
notification centre.

Badge colour comes from the `primary` token, tinted — never severity colours.
`Issues 12` in red would read as "these are critical" when it only means "these
are new".

---

## Email

`RESEND_API_KEY` is optional. Without it the app boots, logs
`outbound email is disabled`, records every send as `SKIPPED` with a reason, and
changes nothing else.

**Setup**

1. Create a key at <https://resend.com/api-keys>
2. Verify your sending domain at <https://resend.com/domains>
3. Set `RESEND_FROM_EMAIL` to an address on that domain
4. Each user turns on **Settings → Notifications → Email notifications**
   (off by default)

The default `onboarding@resend.dev` is Resend's sandbox sender and only delivers
to the account owner. Fine for a first test, wrong for production.

**Attachments.** The email attaches the PDF that was *already generated and
stored* — read off disk, never re-rendered. Over `EMAIL_MAX_ATTACHMENT_BYTES`
(8 MB default) it links to the report instead and the body says why. Resend's own
ceiling is 40 MB for the whole message, and base64 inflates an attachment by
about a third.

**Templates** live in [`email-templates.ts`](../apps/api/src/modules/email/email-templates.ts):
`report-ready`, `scan-failed`, `critical-finding`. Each returns an HTML and a
text body; project names are HTML-escaped.

---

## Queues

| Queue | Concurrency | Registered in |
|---|---|---|
| `scanner` | 3 | `ScannerModule` |
| `reports` | 2 | `ReportsModule` |
| `email` | 5 | `EmailModule` |
| log retention | 1 | `AuditModule` |

All four are consumed by the same Nest process that registers them, so a single
`docker compose up` processes everything and there is no way to accidentally run
two copies of a worker. Scaling the `api` service scales the workers with it —
the queues are the coordination point.

PDF rendering used to happen inside the scan worker, holding one of three scan
slots for the duration of a Chromium print, with no retry and no failure state.
That is why `reports` is its own queue.

---

## Troubleshooting

**A report is stuck on PENDING** — the `reports` queue is not being consumed.
Check Redis is reachable and the API logs show `[Reports]` lines.

**A report is FAILED** — `reports.error` holds the reason. The most common cause
is Chromium missing its shared libraries in a slim container image.

**No email arrived** — check in order: `RESEND_API_KEY` is set; the user's
`emailEnabled` is on; the `email_deliveries` row for the report. A `SKIPPED` row
carries the reason in `failureReason`, and a `FAILED` row carries the provider's
message. Neither ever contains the API key — `EmailService.redact` strips it.

**Badges do not update live** — SSE needs the connection held open; a proxy that
buffers responses breaks it. The counts still refresh on focus and on a two-minute
poll, so this degrades rather than fails.
