# Automatic Reports and Notifications

Two features that are really one pipeline: a scan finishes, its PDF is
generated, and the user is told — in-app, always.

> **2026-08-24:** outbound email (Resend, the hosted relay, PDF-by-email, the
> weekly digest) was removed entirely, along with the standalone mail-relay
> service. In-app notifications were always the primary channel and are
> unaffected — email was only ever an addition on top of them.

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
                              │                                          │
                     NotificationsListener                      REPORT_FAILED notification
                     REPORT_GENERATED                            + audit row
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
| A report is never announced before it exists | `report.generated` is emitted *after* the row reaches `COMPLETED`, by `AutoReportService.markCompleted`. |
| A failed render is never recorded as success | `materialise(…, { strict: true })` on the queue path. The lenient fallback that keeps an HTML snapshot is used only by the synchronous export API. |
| PDF failures are retried, then surfaced | 3 attempts, exponential backoff from 5 s. The final failure writes `status = FAILED`, an audit row, and a `REPORT_FAILED` notification. |
| One notification per scan, not one per finding | `NEW_FINDINGS` carries the severity breakdown in its message. |
| Notifications are private | Every query and mutation is filtered by the authenticated `user.id` in the service. No endpoint accepts a `userId` parameter. |
| Nothing is lost while you are offline | Every notification is a database row before it is streamed. SSE is an optimisation; the counts come from the same query on the next page load. |

---

## Notification types

Adding one is two edits: the `NotificationType` enum in `schema.prisma`, and one
entry in [`notification-catalog.ts`](../apps/api/src/modules/notifications/notification-catalog.ts).
The catalog is typed `Record<NotificationType, NotificationDefinition>`, so a
type added without an entry **fails the build**.

| Type | Category |
|---|---|
| `SCAN_COMPLETED` / `SCHEDULED_SCAN_COMPLETED` | SCANS |
| `SCAN_FAILED` / `SCHEDULED_SCAN_FAILED` | SCANS |
| `REPORT_GENERATED` | REPORTS |
| `REPORT_FAILED` | REPORTS |
| `NEW_FINDINGS` | ISSUES |
| `CRITICAL_FINDING` | ISSUES |
| `SECURITY_WARNING` | SECURITY |
| `SYSTEM_ERROR` | SYSTEM |

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

## Queues

| Queue | Concurrency | Registered in |
|---|---|---|
| `scanner` | 3 | `ScannerModule` |
| `reports` | 2 | `ReportsModule` |
| log retention | 1 | `AuditModule` |

All three are consumed by the same Nest process that registers them, so a single
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

**Badges do not update live** — SSE needs the connection held open; a proxy that
buffers responses breaks it. The counts still refresh on focus and on a two-minute
poll, so this degrades rather than fails.
