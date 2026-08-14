# Scheduled Scans

Recurring, unattended security assessments.

A scheduled scan owns **when** and **with what**. It does not scan. When an
occurrence comes due, the scheduler calls
`AssessmentsService.createAndRun` — the same method the *Run Assessment* button
calls — and the existing pipeline takes it from there. There is one scan engine,
one queue for scans, and one `Assessment` model. A scheduled run is an ordinary
scan that happens to carry `trigger = SCHEDULED`.

```
Scheduled scan
      ↓  (nextRunAt <= now)
Scheduler heartbeat       ← in-process interval, every 60s (see "The heartbeat")
      ↓  (claim the occurrence)
ScheduleDispatcher
      ↓  AssessmentsService.createAndRun(…, { trigger: 'SCHEDULED', scheduleId })
`scanner` queue           ← the SAME queue every manual scan uses
      ↓
ScannerProcessor → plugins → findings → score → report
      ↓
Audit log + live event + notification
      ↓
nextRunAt already advanced; the execution row records the outcome
```

---

## The two tables

### `scheduled_scans`

The rule and the frozen scan configuration.

The configuration columns (`executionMode`, `scanProfileId`, `manualPlugins`,
`enableAiAnalysis`, `maxRequestsPerEndpoint`, `requestDelayMs`, `timeoutMs`)
mirror `assessment_configs` field for field, and are **copied** onto each run
rather than referenced. Editing a schedule must not rewrite the recorded
configuration of scans that already happened.

**No credential is ever stored here.** Target credentials live encrypted on
`auth_configs` and are decrypted by the worker at the point of use. A scheduled
run reads them exactly as a manual run does.

`status` is the durable *intent* and has only three values: `ACTIVE`, `PAUSED`,
`COMPLETED`. `RUNNING` and `FAILED` are **derived on read** from the latest
execution (`displayStatusOf`). Persisting them would leave a schedule stuck at
`RUNNING` forever the first time a worker was killed mid-scan.

### `schedule_executions`

One row per occurrence the schedule *reached* — including the ones it did not
run. "Why did my 02:00 scan not happen?" must be answerable from the table; an
absent row answers nothing.

States: `QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`, plus `SKIPPED` for
an occurrence deliberately not run.

---

## The heartbeat

The scheduler runs on an **in-process interval**, every 60 seconds, started in
`SchedulerService.onModuleInit` and awaited once at boot so occurrences missed
during a restart are picked up immediately.

It used to be a BullMQ repeatable job. **That design was wrong and it failed in
production**, in the worst possible way: silently and permanently, while the UI
kept showing every schedule as `Active`.

BullMQ derives a repeatable job's id from its slot — `repeat:<hash>:<millis>` —
and refuses to insert an id that already exists. Restart the API inside the same
minute as a tick that has already completed, and the boot-time registration
lands on that same slot, collides with the finished job, and the chain that
would have scheduled the next tick is never extended. Redis is then left holding
a repeat *config* with no delayed job behind it. No tick ever runs again, no
error is raised, and every schedule in the installation quietly stops.

This was observed live: an API restart at `23:12:09` against a tick completed at
`23:12:00` killed the scheduler outright, and the only trace anywhere in the
system was `delayed = 0` in Redis. A schedule due at `23:20` simply never ran.

The original argument for the queue was that an in-process timer runs once per
API replica. That argument does not survive scrutiny: **correctness here has
never depended on the timer being singular.** An occurrence is claimed with a
compare-and-swap on `nextRunAt`, and `schedule_executions` is unique on
`(scheduleId, scheduledFor)` — so a second replica ticking at the same instant
loses the claim and does nothing. Ten replicas would be wasteful, not wrong.

Liveness therefore now lives where Redis bookkeeping cannot break it, and
correctness stays where it always was: in Postgres. A timer cannot lose its
chain; if a tick throws, the next one still fires.

Two further protections, both learned from that failure:

- **Nothing escapes the tick.** It is a `setInterval` callback, so an unhandled
  rejection would take the process down and every schedule with it.
- **Silence is made visible.** A failing tick is recorded as
  `scheduler.tick.failed` (category `WORKER`, severity `ERROR`, so it is written
  whatever the log-collection setting) and notifies administrators once per
  failure streak. `GET /scheduled-scans/health` reports `running`, `lastTickAt`
  and `healthy` — a `lastTickAt` older than three minutes means no schedule in
  the installation is being honoured, whatever the list says.

Scans themselves are unaffected: the dispatcher still hands every run to the
ordinary `scanner` queue, with the same concurrency and retry policy as a manual
scan. The `scheduled-scans` queue remains registered only so a legacy repeat
config from the old design can be removed from Redis at boot.

---

## How duplicates are prevented

Two independent layers, and neither depends on the heartbeat being singular.

**1. Compare-and-swap on `nextRunAt`.** Before doing any work, the dispatcher
claims the occurrence:

```sql
UPDATE scheduled_scans
   SET "nextRunAt" = <following occurrence>
 WHERE id = $1 AND status = 'ACTIVE' AND "nextRunAt" = <the value just read>
```

Two instances racing produce exactly one update with `count = 1`. The loser sees
`count = 0` and does nothing at all — no execution row, no scan, no event. This
holds no lock and needs no coordination.

**2. A unique constraint.** `schedule_executions` is `UNIQUE (scheduleId,
scheduledFor)`, and `scheduledFor` is derived from the recurrence rule, never
from a clock. Two processes computing the same occurrence compute the *same
instant*, so a second insert fails on the constraint instead of starting a
second scan. Verified: Postgres rejects it with
`duplicate key value violates unique constraint`.

### `skipIfRunning`

On by default. When an occurrence comes due while a previous run **from the same
schedule** is still `PENDING`/`QUEUED`/`RUNNING`, the new occurrence is recorded
as `SKIPPED` with a reason, an audit event is written, and `nextRunAt` advances
normally. No second scan is started against the same API.

Turning it off is permitted and honoured. `skipIfRunning` also applies to
*Run now* — two concurrent scans of one API are equally unwelcome when a person
asked for the second one.

---

## Timezones

Every schedule stores an **IANA zone name** (`America/Santo_Domingo`), never an
offset. An offset cannot express "02:00 local, before *and* after the clocks
change", which is exactly what an operator means by "every day at 2am".

Conversion uses `Intl.DateTimeFormat`, backed by the platform's own tz database,
so a Node/Bun upgrade picks up rule changes automatically. No date library is
involved and none was added.

Two representations, kept strictly apart:

| | meaning | stored? |
|---|---|---|
| **instant** | an absolute point in time (UTC ms) | yes — `nextRunAt`, `lastRunAt`, `scheduledFor` |
| **wall time** | what a clock in that zone reads | yes — `hour`, `minute`, `weekdays`, `monthDay`, `cronExpression` |

`DAILY`, `WEEKLY`, `MONTHLY` and `CUSTOM` are **wall-clock** rules: 02:00 stays
02:00 whatever the offset does.

`HOURLY` is an **elapsed-time** rule: "every 6 hours" means six hours of real
time, computed as a fixed offset from an anchor (`startAt`, set at creation from
the chosen time of day). Across a DST change the wall time drifts by an hour but
the spacing stays exactly six hours — which is what an operator asking for a
scan every six hours actually wants. Wall-clock matching would produce a five-
or seven-hour gap instead.

### The DST edge cases

**Ambiguous** (autumn, the hour repeats): the **earlier** instant is used, so a
daily scan runs 23 hours after the previous one rather than 25.

**Nonexistent** (spring, the hour is skipped): there is no instant that reads
02:30, so the run is displaced forward by the width of the gap and happens at
03:30. It runs once, on the right day. Skipping the day entirely would silently
drop a security scan.

**Month-end**: "day 31 of every month" runs on 28, 29 or 30 February — clamped,
never skipped. Skipping is defensible for a birthday reminder and indefensible
for a security scan.

All of this is covered by tests in
`apps/api/src/modules/scheduled-scans/recurrence/recurrence.spec.ts`, which pin
both DST directions against `America/New_York`.

---

## Custom recurrences (cron)

`CUSTOM` accepts a 5-field cron expression — `minute hour day-of-month month
day-of-week` — with `*`, `n`, `a,b`, `a-b`, `*/n` and `a-b/n`. It is evaluated
**in the schedule's timezone**, not in UTC.

Deliberately unsupported: nicknames (`@daily`), seconds, named months and days
(`MON`), and the vendor extensions `L`, `W`, `#`.

Cron is an escape hatch, not the interface — the UI puts it under *Custom* and
shows a human description of whatever is typed (`0 2 * * 1` → "Every Monday at
2:00 AM"). The description is rendered by the **server**, by the same code that
will fire the schedule, so the sentence the operator confirms cannot disagree
with the behaviour they get.

**Safety floor:** a rule that would run more often than **once every 15 minutes**
is rejected. This is a vulnerability scanner pointed at somebody's API; a text
box accepting `* * * * *` would be a denial-of-service primitive. The floor is
measured from the rule's own output (`minimumGapMinutes`), so no expression
shape slips past it — `0,1,30 * * * *` is caught as readily as `* * * * *`.

---

## What happens after a restart

Postgres holds the schedules; Redis holds only the heartbeat.

On boot, `SchedulerService.onModuleInit`:

1. **Reconciles schedules.** An `ACTIVE` schedule with no `nextRunAt` would
   never be dispatched again — impossible through the API, but reachable via a
   restored backup — so its next run is recomputed.
2. **Reconciles executions.** Rows left `QUEUED`/`RUNNING` by a process that
   died take their outcome from the assessment they point at. A dispatch that
   never created an assessment is failed after 15 minutes; leaving it pending
   would keep `skipIfRunning` from ever letting the schedule run again.
3. **Starts the heartbeat and sweeps once, awaited**, so occurrences that came
   due during the restart are picked up before boot reports ready rather than up
   to a minute later. It also removes any legacy BullMQ repeat config left by
   the previous design; failing to reach Redis for that cleanup does not stop
   the scheduler, because the heartbeat no longer depends on Redis.

**Missed occurrences are never replayed.** When a schedule is overdue, the
following occurrence is computed from **now**, not from the missed one — so a
service that was down for a week runs the schedule *once* on recovery and
resumes its normal cadence, instead of firing seven days of backlog at a
production API.

The same rule governs **resume**: a schedule paused for three weeks has 21
missed daily occurrences, and resuming produces exactly one next run.

---

## Failure handling

A failed scan **never** disables a schedule.

- The scan ran and failed → the assessment is `FAILED`, the execution is
  `FAILED`, `scheduled_scan.failed` is audited, and the schedule keeps its
  already-advanced `nextRunAt`.
- The scheduler could not *start* a scan at all (specification withdrawn, every
  check disabled, queue unreachable) → the execution is `FAILED` with the
  reason, `consecutiveFailures` increments, and a notification is sent. This one
  is notified because there is no assessment whose absence anyone would notice.

`consecutiveFailures` resets as soon as a run starts. The schedule detail page
surfaces a streak, since a schedule failing unattended is otherwise invisible.

Retries are BullMQ's existing policy (3 attempts, exponential backoff, configured
globally in `AppModule`). Nothing here adds a retry loop of its own.

---

## Run now

`POST /scheduled-scans/:id/run` runs the schedule's configuration immediately
and **does not touch `nextRunAt`**. The automatic series continues exactly as it
would have. The run appears in the execution history with `trigger = MANUAL`,
and the audit trail records `scheduled_scan.run_now` against the person who
asked for it.

---

## Attribution: who started this scan?

An automatic run executes **as the project's owner** — their per-check
enable/disable configuration has to apply, or a scheduled scan would resolve a
different set of checks than their manual one.

The audit trail does **not** therefore claim they started it. Scheduler-initiated
events are written with **no user** and `source = 'scheduler'`:

```
scheduled_scan.started    src=scheduler  user=(none)
scan.queued               src=scheduler  user=(none)
scan.check.completed      src=scheduler  user=(none)
scan.completed            src=scheduler  user=(none)
scheduled_scan.completed  src=scheduler  user=(none)

scheduled_scan.created    src=api        user=<the operator>
scheduled_scan.paused     src=api        user=<the operator>
scheduled_scan.run_now    src=api        user=<the operator>
```

Notifications are the opposite, and deliberately so: they *are* addressed to the
owner, because an unattended run is precisely the one whose result they need
telling about. An audit record answers "who did this"; a notification answers
"who needs to know".

### Events

Recorded: `scheduled_scan.created`, `.updated`, `.paused`, `.resumed`,
`.deleted`, `.run_now`, `.started`, `.completed`, `.failed`, `.skipped`.

They flow over the existing `EventEmitter2` bus, so they appear in the Live
Events viewer alongside everything else, with no separate transport.

---

## Deleting a schedule

Deleting a schedule deletes the **automation only**.

`assessments.scheduleId` is `ON DELETE SET NULL`, so the scans it produced —
and their findings, occurrences and reports — are untouched. The scan detail
page then reads "triggered automatically by a scheduled scan that has since been
deleted". The execution rows cascade, because an execution has no meaning
without the rule that produced it.

Verified end to end: after deleting a schedule, its assessment kept
`status=COMPLETED`, 4 findings and 1 report, with `scheduleId=null`.

---

## Permissions

Roles the product already has, not a parallel permission vocabulary:

| | read | create / edit / pause / resume / delete / run |
|---|---|---|
| `VIEWER` | ✅ | ❌ |
| `ANALYST` | ✅ | ✅ |
| `ADMIN` | ✅ | ✅ |

Enforced by `RolesGuard` on the controller. **Ownership is separate and always
applies**: every service method scopes its query by `project: { userId }`, so a
role never grants access to another user's projects.

---

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/scheduled-scans` | Filter by `search`, `status`, `frequency`, `projectId`; paginated |
| `GET` | `/scheduled-scans/upcoming` | Next few runs, for the dashboard |
| `GET` | `/scheduled-scans/timezones` | IANA zones with current offsets |
| `GET` | `/scheduled-scans/health` | Heartbeat status — `lastTickAt`, `healthy` |
| `POST` | `/scheduled-scans/preview` | Validate and describe a rule without saving |
| `POST` | `/scheduled-scans` | Create |
| `GET` | `/scheduled-scans/:id` | Detail, including upcoming runs |
| `GET` | `/scheduled-scans/:id/executions` | History, paginated |
| `PATCH` | `/scheduled-scans/:id` | Update (`projectId` is not editable) |
| `POST` | `/scheduled-scans/:id/pause` | |
| `POST` | `/scheduled-scans/:id/resume` | Recomputes from now |
| `POST` | `/scheduled-scans/:id/run` | Does not move `nextRunAt` |
| `DELETE` | `/scheduled-scans/:id` | Keeps past scans |

Validation is enforced **server-side** for all of it: project exists, is owned,
is `READY` and has endpoints; profile exists and is reachable by the caller;
every named check is installed; the timezone resolves; a `ONCE` date is in the
future; a weekly rule names at least one day; cron parses and respects the
15-minute floor. The form applies the same rules for immediate feedback, but the
API is reachable without it.

---

## Docker and scaling

No new service. The heartbeat runs inside the API container, which already hosts
the workers, and the scans it starts go to the Redis-backed `scanner` queue the
stack already runs.

Scaling the API to several replicas is safe by construction: every replica ticks,
and the compare-and-swap plus the unique constraint mean exactly one of them
starts each scan. The others do nothing at all — no execution row, no scan, no
event. Extra replicas cost one indexed query a minute each.

**Redis retention:** the heartbeat writes nothing to Redis at all, so it cannot
grow the queue. Scans use the `scanner` queue's existing retention. Trimming
Redis never removes a scan, a finding or a report — those live in Postgres.

---

## Where the code lives

```
apps/api/src/modules/scheduled-scans/
├── recurrence/
│   ├── zoned-time.ts          IANA wall-clock ↔ instant conversion
│   ├── cron.ts                5-field parser
│   └── recurrence.ts          computeNextRun, describeRecurrence, safety floor
├── schedule-rule.ts           toRule / displayStatusOf (shared, no cycle)
├── scheduled-scans.service.ts CRUD, validation, presentation
├── schedule-dispatcher.service.ts  claim → skip check → createAndRun
├── scheduler.service.ts       the heartbeat, health, and boot reconciliation
├── schedule-execution.listener.ts  syncs executions from scan.* events
└── scheduled-scans.controller.ts
```

Frontend: `apps/web/src/app/(dashboard)/scheduled-scans/`,
`apps/web/src/components/scheduled-scans/`, `apps/web/src/lib/schedule-list.ts`.
