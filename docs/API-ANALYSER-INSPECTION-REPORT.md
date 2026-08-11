# API Analyser — Inspection Report (Phase −1)

**Date:** 2026-07-19
**Commit inspected:** `0739fe4` (+ pre-existing uncommitted working tree)
**Scope:** Read-only inspection. No files created, modified or deleted in the repository.
**Verification method:** every claim below is anchored to a file and line number that was read directly. Where I could not verify something, it is marked `UNVERIFIED`.

---

## 0. Repository state — attribution

`git status` at the end of the inspection is **byte-identical** to `git status` at the start. `HEAD` unchanged (`0739fe4`). Stash list empty.

**All 25 modified / 14 untracked entries existed before I started.** None are mine. Notably pre-existing and relevant to this plan:

- `AUDIT.md`, `ARCHITECTURE.md` — untracked, authored previously.
- `apps/api/src/common/utils/url-resolver.util.spec.ts` — untracked; the **only** test file in the repo.
- `apps/web/src/app/(dashboard)/assessments/[assessmentId]/`, `findings/[findingId]/`, `components/assessments/`, `components/filters/`, `project-card.tsx`, `project-filters.tsx`, `lib/assessment-list.ts`, `lib/project-list.ts` — untracked; work in progress that already partially anticipates this reform.
- `D apps/web/src/components/tables/data-table-view-options.tsx` — deleted but not staged.

> Recommendation before Phase 0: commit or stash this working tree. Starting a multi-phase reform on top of 39 uncommitted entries makes rollback and review materially harder.

---

## 1. Endpoint inventory

Global prefix `/api/v1`. Better Auth mounted separately at `/api/auth/*` (`main.ts:25-40`), before Nest routing. URI versioning enabled (`main.ts:78`) but no controller declares a version.

Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` (`main.ts:81-88`) — **mass assignment via DTO-typed bodies is blocked**. Bodies typed `any` / `object` / inline TS types bypass validation entirely (class-validator has no metadata for them).

Legend for **State**: `OK` working · `INC` incomplete · `UNUSED` no consumer · `UNSAFE` authz/validation gap · `NO-FE` no frontend · `NO-BE` no backend.

### 1.1 Auth — `auth.controller.ts`

| Method | Route | Service | DTO | Guard / Role | Response | FE consumer | State |
|---|---|---|---|---|---|---|---|
| POST | `/auth/register` | `auth.service.register` | `RegisterDto` | `@Public` | user + token | `authApi.register` | OK |
| POST | `/auth/login` | `auth.service.login` | `LoginDto` | `@Public` | user + token | `authApi.login` | OK |
| POST | `/auth/exchange-session` | `auth.service.exchangeSession` | `@Body('token')` raw | `@Public` | JWT | `authApi.exchangeSession` | OK |
| GET | `/auth/me` | `auth.service.me` | — | JWT | user | `authApi.me` | OK |

Dual auth: Better Auth sessions **and** legacy JWT, bridged by `exchange-session`. JWT is stored in `localStorage` (`api.ts:16`) — XSS-readable.

### 1.2 Projects — `projects.controller.ts` (all JWT, owner-scoped)

| Method | Route | Service | DTO | Response | FE consumer | State |
|---|---|---|---|---|---|---|
| GET | `/projects` | `findAll` | — | projects + `findingsCount`, `lastScanStatus` | `projectsApi.list` | OK |
| GET | `/projects/:id` | `findOne` | — | project + spec + endpoints + last 5 assessments | `projectsApi.get` | OK |
| POST | `/projects` | `create` | `CreateProjectDto` | project (DRAFT) | `projectsApi.create` | OK |
| POST | `/projects/drafts` | `createDraft` | `SaveProjectDraftDto` | project | `projectsApi.createDraft` | OK |
| PUT | `/projects/:id/draft` | `saveDraft` | `SaveProjectDraftDto` | project | `projectsApi.saveDraft` | OK |
| POST | `/projects/:id/finalize` | `finalize` | — | project READY / `fieldErrors` | `projectsApi.finalize` | OK |
| PUT | `/projects/:id` | `update` | `UpdateProjectDto` | project | `projectsApi.update` | OK |
| DELETE | `/projects/:id` | `remove` | — | 204 (soft delete `isActive=false`) | `projectsApi.delete` | OK |
| POST | `/projects/:id/spec/url` | `importOpenApiFromUrl` | `@Body('url')` raw | apiSpec | `projectsApi.importFromUrl` | OK |
| POST | `/projects/:id/spec/upload` | `importOpenApiFromContent` | `@Body('spec') object` | apiSpec | `projectsApi.importFromContent` | **UNSAFE** |
| POST | `/projects/:id/auth` | `saveAuthConfig` | `@Body() any` | **raw AuthConfig incl. plaintext secrets** | `projectsApi.saveAuth` | **UNSAFE** |

Ownership enforced by `assertOwner` (`projects.service.ts:300-306`) and `where: { userId }` on reads. Isolation is genuinely correct here.

### 1.3 Assessments — `assessments.controller.ts` (all JWT, owner-scoped via `project: { userId }`)

| Method | Route | Service | DTO | Response | FE consumer | State |
|---|---|---|---|---|---|---|
| GET | `/assessments` | `findAll` | `?projectId` | all assessments, **no pagination** | `assessmentsApi.list` | INC |
| GET | `/assessments/dashboard` | `getDashboardStats` | — | stats | `assessmentsApi.dashboard` | **INC** (see §6) |
| GET | `/assessments/:id` | `findOne` | — | assessment + config + summary + **all** findings + 500 logs | `assessmentsApi.get` | INC |
| POST | `/assessments/projects/:projectId/run` | `createAndRun` | `RunAssessmentDto` | assessment | `assessmentsApi.run` | OK |
| DELETE | `/assessments/:id` | `cancel` | — | assessment CANCELLED | `assessmentsApi.cancel` | INC |
| SSE | `/assessments/:id/progress` | `streamProgress` | `?token=<JWT>` | progress events | assessment detail page | **UNSAFE** |

### 1.4 Findings — `findings.controller.ts` (all JWT, owner-scoped)

| Method | Route | Service | DTO | Response | FE consumer | State |
|---|---|---|---|---|---|---|
| GET | `/findings` | `findAll` | 5 query filters | findings, **no pagination** | `findingsApi.list` | INC |
| GET | `/findings/stats` | `getStats` | — | groupBy severity/owasp/status | `findingsApi.stats` | INC |
| GET | `/findings/:id` | `findOne` | — | finding + **plaintext `httpRequest`** | `findingsApi.get` | **UNSAFE** |
| PATCH | `/findings/:id/status` | `updateStatus` | `@Body('status')` raw string | finding | `findingsApi.updateStatus` | **INC** |

`updateStatus` casts `status as any` (`findings.service.ts:65`) — an invalid enum reaches Postgres and surfaces as a 500 rather than a 400. No audit trail is written.

### 1.5 Reports — `reports.controller.ts` (all JWT, owner-scoped)

| Method | Route | Service | Response | FE consumer | State |
|---|---|---|---|---|---|
| GET | `/reports/stats` | `getStats` | totals + trend | `reportsApi.stats` | **INC** (see §6) |
| GET | `/reports` | `findAll` | flat list, one row per format | `reportsApi.list` | INC |
| GET | `/reports/assessment/:id/generate` | `ReportGeneratorService` | file download | `reportsApi.generate` | **INC** |
| GET | `/reports/assessment/:id` | `findByAssessment` | reports | `reportsApi.listByAssessment` | OK |
| GET | `/reports/:id` | `findOne` | report + assessment + findings | `reportsApi.get` | OK |
| DELETE | `/reports/:id` | `remove` | `{message}` | `reportsApi.delete` | OK |

`generate` is a **GET with a write side effect** — it creates a `Report` row on every download (`reports.controller.ts:96-102`). It regenerates content from **current mutable data**, and `createRecord` persists **no `content` and no `filePath`** (`reports.service.ts:161-178`). Reports are therefore metadata-only pointers; the bytes are discarded. Historical reports are not reproducible.

### 1.6 Plugins & Profiles

| Method | Route | Guard | State |
|---|---|---|---|
| GET | `/plugins` | JWT | OK |
| GET | `/plugins/categories` | JWT | **INC** — returns all 13 enum values; only 6 have plugins |
| GET | `/plugins/:id` | JWT | OK |
| PUT | `/plugins/:id/toggle` | JWT | OK (per-user `PluginUserConfig`) |
| PUT | `/plugins/:id/config` | JWT | INC (`@Body() Record<string,any>`, unvalidated) |
| GET | `/plugins/:id/executions` | JWT | OK |
| GET | `/plugins/:id/findings` | JWT | OK |
| POST | `/plugins/:id/run` | JWT | **NO-FE** — `pluginsApi.run` exists in client, no UI calls it |
| GET | `/plugins/profiles` | JWT | OK |
| GET | `/plugins/profiles/:id` | JWT | OK |
| POST | `/plugins/profiles` | JWT | **UNSAFE** — inline type, `enabledPlugins: string[]` unvalidated |
| PUT | `/plugins/profiles/:id` | JWT | **UNSAFE** — same |
| DELETE | `/plugins/profiles/:id` | JWT | OK |

Profile ownership is enforced (`profiles.service.ts:95,112,123`) and system profiles are immutable. But arbitrary/non-existent plugin IDs can be stored, because there is no DTO and no registry check on write.

### 1.7 AI — `ai.controller.ts` — **`JwtAuthGuard` only, NO `RolesGuard`**

| Method | Route | State |
|---|---|---|
| GET | `/ai/status` | OK |
| GET | `/ai/config` | **UNSAFE** |
| GET | `/ai/config/env-status` | **UNSAFE** |
| PUT | `/ai/config/deactivate-all` | **UNSAFE** |
| GET | `/ai/config/:provider` | **UNSAFE** |
| PUT | `/ai/config/:provider` | **UNSAFE** |
| PUT | `/ai/config/:provider/activate` | **UNSAFE** |
| POST | `/ai/config/:provider/test` | **UNSAFE** |
| DELETE | `/ai/config/:provider` | **UNSAFE** |

These mutate **global platform state** (`AiProviderConfig` has no `userId`). Any authenticated user — including `VIEWER` — can read masked keys, overwrite the platform API key, switch providers, or disable AI for everyone. This is a real privilege-escalation surface and was not in the original brief's Phase 0 list.

### 1.8 Users — `users.controller.ts` — `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN')` class-wide

All routes ADMIN-only except `verify-invite` (`@Public` + `@Roles()`) and `accept-invite` (`@Roles()` → empty array → `RolesGuard` returns `true`, so any authenticated user). Both exemptions are intentional and correct. `GET /users/audit-logs` has real `limit`/`offset` pagination — **the only paginated endpoint in the backend.**

### 1.9 Missing / dead

| Item | Status |
|---|---|
| `/finance/summary`, `/finance/usage` | **NO-BE** — `financeApi` (`api.ts:219-224`) calls them; `apps/api/src/modules/finance/` is an **empty directory**. Guaranteed 404. |
| API tokens CRUD | **NO-BE** — `ApiKey` model exists in schema; `prisma.apiKey` has **zero** references in backend source. UI uses `MOCK_TOKENS`. |
| `ProjectSecret` | **UNUSED** — model declared, zero code references. Dead table. |
| `POST /plugins/:id/run` | **NO-FE** |
| Issues / occurrences / comparison / score APIs | **NO-BE** — do not exist yet (Phases 1C–2). |

---

## 2. Database & migrations

### 2.1 Migration history is not reproducible — decisive finding

```
prisma/migrations/
  20260718120000_project_drafts/migration.sql   ← "-- Baseline migration.
                                                    -- Project draft columns were previously
                                                    -- applied with `prisma db push`."   (comments only)
  20260718190000_assessment_resolved_plugins/migration.sql
                                                ← ALTER TABLE "assessment_configs" ADD COLUMN "resolvedPlugins"
```

- **There is no `CREATE TABLE` anywhere.** No initial migration exists.
- **`migration_lock.toml` is absent.**
- Consequences, by inspection of `package.json` scripts:
  - `db:migrate:prod` (`prisma migrate deploy`) against an empty DB → the `ALTER TABLE` targets a table that was never created → **fails**.
  - `db:reset` (`prisma migrate reset --force`) → drops everything, replays two migrations, one of which is comments → **leaves a broken/empty database**.
  - The **only** working provisioning path today is `prisma db push`.
- `README.md` Quick Start instructs `cp .env.example .env` — **`.env.example` does not exist**. Quick Start is broken as written.

**This is good news given your constraints.** Because the data is disposable, Phase 1B is not a risky backfill — it is *establishing a correct baseline that never existed*. That removes the single largest risk I flagged in my first message.

### 2.2 Models (25 total)

`User`, `ApiKey`, `Session`, `Account`, `Verification`, `Invitation`, `Project`, `ProjectSecret`, `ApiSpec`, `AuthConfig`, `Endpoint`, `Assessment`, `AssessmentConfig`, `AssessmentSummary`, `AssessmentLog`, `Finding`, `Report`, `Plugin`, `PluginUserConfig`, `PluginExecution`, `ScanProfile`, `AiProviderConfig`, `AuditLog`.

### 2.3 Cascades

| Relation | Rule | Consequence |
|---|---|---|
| `Project → User` | Cascade | delete user ⇒ all projects |
| `Assessment → Project` | Cascade | delete project ⇒ all scans |
| `Finding → Assessment` | **Cascade** | **delete scan ⇒ findings + triage destroyed** |
| `Finding → Endpoint` | SetNull | re-import spec ⇒ finding orphaned from endpoint |
| `Report → Assessment` | Cascade | delete scan ⇒ reports gone |
| `PluginExecution → Assessment` | SetNull | execution history survives |
| `AuditLog → User` | SetNull | audit survives user deletion |
| `AssessmentConfig → ScanProfile` | SetNull | deleting a profile keeps history |

Note `parseAndSaveSpec` does `endpoints: { deleteMany: {}, create: endpoints }` (`projects.service.ts:213-216`) — **re-importing a spec deletes and recreates every endpoint row with new IDs**, so all existing findings have `endpointId` nulled. Endpoint identity does not survive spec re-import. This directly constrains fingerprint design (§5.4).

### 2.4 Indexes — effectively none

The schema declares **zero `@@index`**. Only `@id`, `@unique`, `@@unique([projectId,key])`, `@@unique([apiSpecId,path,method])`, `@@unique([pluginId,userId])` exist. PostgreSQL does **not** auto-index foreign keys, so every one of these is a sequential scan:

`Project.userId` · `Assessment.projectId` · `Assessment.status` · `Assessment.createdAt` · `Finding.assessmentId` · `Finding.endpointId` · `Finding.severity` · `Finding.status` · `Report.assessmentId` · `PluginExecution.assessmentId` · `PluginExecution.pluginId` · `AssessmentLog.assessmentId` · `AuditLog.userId` · `AuditLog.createdAt` · `Session.userId` · `Account.userId`.

Every dashboard/report aggregate walks these unindexed. Cheap, high-value fix in Phase 1A.

### 2.5 Seed (`src/prisma/seed.ts`)

Creates exactly: admin (`admin@apianalyser.local`), analyst (`analyst@apianalyser.local`), one project `demo-project-001` (PetStore).

Gaps:
- Does **not** seed `Plugin` rows — not needed: `PluginRegistryService.onModuleInit` upserts all 10 plugins on boot (`plugin-registry.service.ts:34-37, 73-120`). Correct design.
- Does **not** seed system `ScanProfile`s. `profiles.service.ts:75` can create them (`isSystem: true`) but nothing invokes it at startup — **UNVERIFIED whether any system profile exists in the live DB.**
- The demo project gets `status: READY` by schema default (`ProjectStatus @default(READY)`, `setupStep @default(3)`) but has **no `ApiSpec`**. So the seeded project is in an impossible state: READY but unscannable. `createAndRun` will reject it at `projects.service`-equivalent check (`assessments.service.ts:87-89`).

### 2.6 Can the DB be regenerated cleanly?

**Yes — and it should be.** Recommended Phase 1B sequence (not executed):
1. `docker compose down -v` (or drop/recreate the `api_analyser` database).
2. Delete the two stub migration folders.
3. `prisma migrate dev --name init` → produces a real initial migration containing the full `CREATE TABLE` set **plus** the new domain models and indexes from Phase 1A.
4. `prisma migrate deploy` verified against a genuinely empty database.
5. `db:seed` extended (system profiles, a spec for the demo project, optional demo scan).

No backfill script is required. No data-preservation risk.

### 2.7 What `SecurityIssue` / `FindingOccurrence` touches

| Area | Impact |
|---|---|
| `Finding` model | Split into `SecurityIssue` (identity + triage) and `FindingOccurrence` (immutable per-scan detection) |
| `scanner.processor.ts:157-185` | Rewrite the persistence block: fingerprint → upsert issue → create occurrence → lifecycle transitions |
| `findings.service.ts` (whole file) | Replaced by an issues service; `updateStatus` becomes a lifecycle transition writing `IssueStatusChange` |
| `assessments.service.ts:41,54,235-239` | `_count.findings`, `include.findings`, severity `groupBy` all move to occurrences/issues |
| `projects.service.ts:34,43` | `findingsCount` becomes open-issue counts |
| `reports/*` | `report-generator` reads `assessment.findings` — must read occurrences with snapshots |
| `plugins.service.getFindings` | Repoint to occurrences |
| `Endpoint.findings` relation | Moves to occurrences; issue keeps a resilient path/method rather than depending on `endpointId` |
| Frontend | `/findings` list + `[findingId]` detail + dashboard severity counts + project cards |

---

## 3. Phase 0 security validation

### 3.1 `ENCRYPTION_KEY` fallback — **CONFIRMED, worse than reported**

Two hardcoded fallbacks with **different values**:

- `config/configuration.ts:22` → `'fallback-encryption-key-32chars'` (31 chars)
- `ai-config.service.ts:454` → `'fallback-encryption-key-32chars!!'` (33 chars)

Key derivation is `Buffer.from(raw.padEnd(32).slice(0, 32), 'utf8')` (`ai-config.service.ts:455`) — space-padded, so the two fallbacks derive **different keys**. Anything encrypted under one cannot be decrypted under the other. Both values are public in the repository. The process starts silently with either.

**Also in scope, same class, not in your original list:**
- `configuration.ts:15` → `JWT_SECRET` fallback `'fallback-secret-change-in-production'`
- `configuration.ts:17` → `REFRESH_TOKEN_SECRET` fallback `'fallback-refresh-secret'`

A known JWT signing secret permits **forging tokens for any user**, which is strictly more severe than the encryption-key issue. Phase 0 must fail-fast on all three.

### 3.2 AuthConfig encryption — **CONFIRMED NOT ENCRYPTED**

The schema comments claim encryption (`schema.prisma:335,339,342,347-348` `// encrypted`). They are aspirational.

- The **only** crypto in the backend is `private encrypt/decrypt` inside `ai-config.service.ts:458-474`, scoped to AI provider keys.
- `saveAuthConfig` (`projects.service.ts:289-295`) allow-lists keys then upserts the **raw values**. No encryption call.
- `scanner.processor.ts:104-110` reads `spec.authConfig?.token` etc. **directly, with no decrypt** — proving the values are plaintext at rest.

**Additionally:** `saveAuthConfig` **returns the raw upsert result** (`projects.service.ts:297`), so `POST /projects/:id/auth` echoes the bearer token / password / API key / client secret straight back to the client. `sanitizeAuthConfig` (`:341-345`) is applied only in `toProjectResponse`, i.e. on GET paths — never on this write path.

`ProjectSecret.value // AES-256 encrypted` — the model is entirely unused, so the comment is moot.

### 3.3 Secret exposure in evidence / logs / reports / AI

**Evidence — CONFIRMED, the most serious finding.**

`BasePlugin.getAuthHeaders` (`scanner.types.ts:130-157`) builds real credentials:
- `Authorization: Bearer <user's real token>`
- `Authorization: Basic <base64(user:password)>` — trivially reversible
- `<custom header>: <api key>`

`BasePlugin.buildRequestString` (`scanner.types.ts:114-120`) serialises **all** headers verbatim with no filtering. All 10 plugins pass `authHeaders` into it (`bola:83`, `bfla:70`, `cors:79,107`, `mass-assignment:105`, `rate-limit:104`, `sensitive-data:174`, `ssrf:106`, `broken-auth:71,124`). The result is persisted to `findings.httpRequest` (`scanner.processor.ts:177`) in plaintext and returned by `GET /findings/:id`.

**Logs — CONFIRMED.** `LoggingInterceptor` logs `${method} ${url}` including the query string. Combined with §3.4 this writes valid JWTs into application logs on every SSE connection.

**Reports — NOT affected.** `grep` for `httpRequest|httpResponse|evidence` in `report-generator.service.ts` returns **no matches**. Reports do not render raw evidence.

**AI — NOT affected.** The prompt sends only title, severity, OWASP category, `affectedUrl`, and `description.substring(0,400)` (`ai.service.ts:130-132`). No evidence, no headers. Safe — but also context-poor, which caps AI quality (relevant to Phase 8).

Net: exposure is **at rest in Postgres** and **over the findings API**, not in reports or to third parties.

### 3.4 SSE token in URL — **CONFIRMED**

`jwt.strategy.ts:25` adds a fallback extractor `(req) => req?.query?.token`. `api.ts:92` builds `new EventSource(.../progress?token=${token})`. The JWT therefore appears in the URL → server access logs, `LoggingInterceptor` output, browser history, and any proxy in between.

### 3.5 SSRF & URL validation — **largely CORRECT**

`url-resolver.util.ts` is genuinely good work:
- protocol allow-list `http:`/`https:`, rejects embedded credentials (`:26-28`)
- DNS resolution with `lookup(..., {all:true})` and a thorough private/reserved-range check covering IPv4, IPv6, `::ffff:` mapped, CGNAT, link-local, TEST-NET (`:45-59`)
- `ALLOW_PRIVATE_TARGETS=true` escape hatch (`:29`) — **the hosted vs. local mode separation your brief asks for already exists**
- caller sets `maxRedirects: 0`, `maxContentLength/maxBodyLength: 5 MB`, `timeout: 15000` (`projects.service.ts:160-167`)

Residual gaps:
1. **DNS rebinding (TOCTOU)** — validation resolves the hostname, then axios resolves it *again* independently. A hostile DNS server can return a public IP to the check and a private IP to the request. Fix: pin the validated IP and send `Host:`.
2. **`SwaggerParser.dereference` is unguarded on the upload path.** `parseAndSaveSpec` (`projects.service.ts:194`) runs on **both** URL and upload input. `dereference` resolves external `$ref`s — including `http(s)://` (SSRF that bypasses `assertSafeRemoteUrl` entirely) and potentially `file://` (local file read). This is the most significant SSRF gap and it is reachable by any authenticated user via `POST /projects/:id/spec/upload`.
3. Minor over-blocking: `(a===203 && b===0)` and `(a===198 && b===51)` block /16s where only /24s are reserved. Harmless.

### 3.6 OpenAPI upload limits

- Body cap is the global `express.json({ limit: '10mb' })` (`main.ts:43`). No endpoint-specific limit.
- No content-type check, no extension check, no declared-size pre-check.
- No timeout/размер bound on `$ref` resolution (see above).
- `@Body('spec') spec: object` is untyped → `ValidationPipe` cannot inspect it.

### 3.7 Resource authorization — **CORRECT for user isolation**

Every domain service scopes by owner: projects `where:{userId}` + `assertOwner`; assessments/findings/reports `where:{ ... project:{ userId } }`; profiles check `isSystem || userId`. I found **no IDOR** in projects, assessments, findings or reports.

Exception: **the entire `/ai/config/*` surface** (§1.7) — global state, authenticated-only, no role check.

Note: `User.ownerId` self-relation (`schema.prisma:154,159-160`) hints at a workspace model, but **no query uses it**. Isolation is strictly per-user today.

### 3.8 Fake / incomplete features

| Item | Evidence |
|---|---|
| Finance | `apps/api/src/modules/finance/` **empty dir**; `financeApi` calls 2 non-existent routes; nav entry `nav-data.ts:45`; page `(dashboard)/finance/page.tsx` |
| `MOCK_TOKENS` | `settings/page.tsx:364-383`; state-only CRUD; `copyToken(preview)` copies the **masked placeholder** `api_analyser_••••••••••••efg3` |
| Empty plugin categories | `PluginCategory` has 13 values; only **6** are used (AUTHENTICATION, AUTHORIZATION, HEADERS, PERFORMANCE, COMPLIANCE, INFRASTRUCTURE). `GET /plugins/categories` returns all 13, exposing INJECTION, API_DESIGN, AI, CLOUD, GRAPHQL, GRPC, SOAP with zero implementations |
| Empty component dirs | `components/examples/`, `components/findings/` — both empty |
| AI Usage | tokens captured in `aiMeta` → stored inside `AssessmentSummary.aiStatus` JSON only. No queryable usage table, no cost. Cannot back a real "AI Usage" page |

---

## 4. Scanner & assessment flow

### 4.1 End-to-end path

1. `POST /assessments/projects/:projectId/run` → `createAndRun` (`assessments.service.ts:69`)
2. Guards: project owned + `status === READY` + spec exists + endpoints > 0 (`:83-92`)
3. **Plugin resolution happens here, before queueing** (`:94-129`) — detailed in §4.4
4. `Assessment` created `status: QUEUED` with nested `AssessmentConfig` incl. frozen `resolvedPlugins` (`:131-149`)
5. `scannerQueue.add('run-assessment', {...}, { jobId: 'assessment-<id>' })` (`:151-160`); `jobId` persisted (`:162-165`)
6. `ScannerProcessor.process` (`@Processor('scanner', { concurrency: 3 })`) → status `RUNNING`, progress 0 (`scanner.processor.ts:42-45`)
7. Loads spec + project + config; re-resolves plugins from `resolvedPlugins` with legacy fallbacks (`:52-89`)
8. Builds `ScanContext` (auth, endpoints, config) (`:98-131`)
9. Creates `AssessmentSummary` **immediately, with schema defaults** (`:133-135`) ← source of the score bug
10. `ScannerService.runAllPlugins` — sequential plugin loop + AI post-pass (`scanner.service.ts:110-198`)
11. Findings persisted via `Promise.all(map(create))` — no transaction, no dedup (`:157-185`)
12. Summary recomputed and written (`:190-206`); assessment → `COMPLETED`, `progress: 100` (`:210-219`)
13. `autoGenerateReport` fire-and-forget (`:222-224`)
14. Final SSE `completed: true` (`:226-236`)

### 4.2 BullMQ / Redis / worker

Queue `scanner`, concurrency 3, deterministic `jobId`. The worker runs **in the same Nest process** as the API — this is load-bearing, because progress travels over in-process `EventEmitter2` (`scanner.processor.ts:270` → `assessments.service.ts:27-29`). Splitting the worker into its own process would silently break SSE. Worth documenting; not worth changing now.

### 4.3 SSE & progress persistence

`streamProgress` (`assessments.service.ts:188-217`) replays a synthetic initial event from persisted `status`/`progress`/`currentStep`, then streams a `Subject`.

Defects:
1. **`progressSubjects` is `Map<assessmentId, Subject>` holding one subject.** A second viewer overwrites the first (`:196`) — the first tab silently stops updating. Two tabs / two devices break.
2. **No heartbeat.** Idle proxies will drop the connection.
3. **Hard 10-minute `setTimeout` completes the stream** (`:198-203`) regardless of scan state — a longer scan loses its stream.
4. **No client-disconnect cleanup** — subjects leak until the timeout fires.
5. **`currentStep` is only persisted on FAILED/COMPLETED.** `updateProgress` (`:273-278`) writes **only** `progress`. So a mid-scan refresh restores a percentage with no phase name.
6. No polling fallback; no reconnect/dedup logic.

Progress *is* genuinely real (driven by plugin loop), not simulated — that part matches the brief's requirement already.

### 4.4 all / profile / manual — **selection is correct; one honest discrepancy**

`createAndRun` (`assessments.service.ts:94-129`):
- `profile` → profile must exist and be `isSystem || own`, must be non-empty
- `manual` → deduped, must be non-empty
- `all` → all user-enabled plugin IDs
- **`unknownIds` checked against the registry and rejected with 400 *before* queueing** (`:119-120`)

**Your brief's requirement "block profiles with non-existent plugins before enqueueing" is already satisfied.** The worker's `getByIds` length check (`scanner.processor.ts:87-89`) is a correct second line of defence.

The one real discrepancy: `resolvedPlugins = requestedIds.filter(id => enabledIds.has(id))` (`:122`). If you select 5 checks in manual mode and 2 are disabled, it **silently runs 3** and only errors when zero remain. The UI shows 5. That violates "ejecuta exactamente lo mostrado."

Secondary: `PluginExecutionPlan.skippedReason` labels every non-selected plugin `disabled_by_user` (`scanner.service.ts:87`) even when it was simply not part of a profile. That metadata feeds scope-aware comparison later, so it needs to distinguish *not selected* from *disabled*.

### 4.5 Failure handling

`catch` sets `FAILED` + `currentStep: 'Failed: <msg>'`, logs, emits, rethrows (`scanner.processor.ts:245-264`).

**It does not touch `AssessmentSummary`.** Since the summary row was created at step 9 with `securityScore Float @default(100)`, **a scan that fails during plugin execution leaves a persisted summary claiming a perfect score of 100.** This is the concrete mechanism behind "un scan fallido cuenta como 100."

Also: no BullMQ retry/backoff config; `cancel` removes the job but the processor has **no cancellation checks**, so an already-running scan continues to completion and overwrites `CANCELLED`.

### 4.6 Reports from scans

`autoGenerateReport` (`:286-311`) renders a PDF then calls `createRecord` with `fileSize` only — **the generated bytes are discarded**. Combined with §1.5, no report artifact is ever stored.

---

## 5. Current Finding model

### 5.1 Creation

Exactly one site: `scanner.processor.ts:157-185`, one `prisma.finding.create` per finding, inside `Promise.all`, no transaction. `aiSummary` and `aiGeneratedAt` are never written (only `aiAnalysis`) — two dead columns.

### 5.2 Identity

`id` is a random `cuid()`. **There is no fingerprint, no `projectId`, no `ruleId`, no `firstSeenAt`/`lastSeenAt`, no occurrence counter.** A finding's only context is `assessmentId` + optional `endpointId`. `Finding.pluginId` is a plain string with no FK.

Critically, `Finding` mixes two lifetimes in one row: **per-scan detection data** (`evidence`, `httpRequest`, `httpResponse`, `assessmentId`) and **cross-scan triage state** (`status`, `notes`). That is the architectural defect.

### 5.3 Deduplication

**None.** Not at write time, not at read time, not by unique constraint.

### 5.4 Behaviour across scans

Scan the same API twice with the same checks → every finding is inserted again with a fresh `cuid()` and `status: OPEN`. Ten scans of one unchanged vulnerability produce **ten independent rows**, each requiring separate triage, each counted separately in every dashboard aggregate (`assessments.service.ts:235-239` counts *all* findings ever, and `projects.service.ts:43` sums `findingsCount` across all scans).

### 5.5 Resolving a finding

`updateStatus` writes `status` + `notes` to that **one row** (`findings.service.ts:62-69`). No history, no actor, no timestamp beyond `updatedAt`, no reason. The next scan creates a new `OPEN` row; the resolution is invisible to it. **Triage does not survive a rescan.**

### 5.6 Deleting an assessment

`Finding.assessment` is `onDelete: Cascade` (`schema.prisma:489`). Deleting a scan **permanently destroys every finding and all triage work attached to it**. Deleting a project cascades further. There is no protection whatsoever.

### 5.7 Impact of the new model

| Concern | Consequence |
|---|---|
| Fingerprint | `pluginId + method + path` is insufficient — `security-headers` emits ≥4 distinct rules per endpoint and they would collide. Must include `ruleId` + affected component. **Plugins currently emit no `ruleId`** — it must be added to all 10 plugins (deriving it from `title`/`category` is a viable interim). |
| Path normalisation | Endpoint rows are wiped on spec re-import (§2.3), so fingerprints must key on the **normalised template path** (`/users/{id}`), not `endpointId`. |
| Occurrence snapshots | `report-generator` and reports must read snapshot columns so history stays correct after spec/plugin changes. |
| Cascade | `FindingOccurrence → Assessment` may cascade; **`SecurityIssue` must hang off `Project`, never off `Assessment`**, so deleting a scan cannot erase triage. |
| Scope tracking | Lifecycle rule "not detected ≠ resolved" needs per-scan record of which rules/endpoints were actually evaluated — `pluginResults.executed` exists and is a usable foundation, but rule-level and endpoint-level scope does not yet exist. |

---

## 6. Security Score — three divergent implementations

### 6.1 Assessment score — `scanner.processor.ts:313-338`

```
score = 100 − (critical×20) − (high×10) − (medium×5) − (low×2), clamped [0,100]
```
- Saturates at 0 after 5 criticals — no discrimination beyond that.
- **Ignores scope entirely**: the parameter is literally `_totalEndpoints` (unused). 1 finding from 1 check scores the same as 1 finding from 10 checks.
- INFO ignored.
- `riskLevel` ladder at `:327-331` has a redundant branch (`high > 2` then `high > 0`).

### 6.2 Project score

**Does not exist.** `projects.service.findAll` returns `findingsCount` (total findings across all scans, `:43`) and `lastScanStatus` (`:44`) — no score, no posture, no severity split.

### 6.3 Global dashboard score — `assessments.service.ts:251-255`

```js
const avgScore = assessments.length > 0
  ? assessments.reduce((sum, a) => sum + (a.summary?.securityScore ?? 100), 0) / assessments.length
  : 100;
```
Where `assessments` = **last 10 COMPLETED scans across all projects** (`:229-234`).

Every failure mode in your brief, confirmed:
1. Averages **scans**, not projects — a project scanned 10× drowns out every other project.
2. `?? 100` — a completed scan with no summary contributes a perfect score.
3. `: 100` — **a user with zero scans sees 100/100.** "Never assessed" renders as "perfect".
4. Arbitrary 10-scan window.
5. `totalAssessments: assessments.length` (`:259`) is the **window size, capped at 10** — not the real total. A user with 50 scans sees "10".

### 6.4 Reports stats score — `reports.service.ts:102-110`

```js
avgSecurityScore = Math.round(assessments.reduce((s,a) => s + (a.summary?.securityScore || 100), 0) / assessments.length)
```
Uses `|| 100` instead of `?? 100`. **A genuine score of `0` — the worst possible posture — is coerced to `100`.** Same bug repeats in the trend at `:139`, where `trendMap[day].score` is *overwritten* per assessment (last one wins) while counts are summed — an internally inconsistent series.

### 6.5 FAILED / RUNNING / no-summary

| State | Behaviour |
|---|---|
| FAILED | Excluded from dashboard/report averages (`status: 'COMPLETED'` filter). **But** the row persisted at `scanner.processor.ts:133-135` retains `securityScore = 100` from `@default(100)` and is shown wherever a summary is read directly (scan list, scan detail). |
| RUNNING/QUEUED | No summary until step 9; UI must handle null. |
| COMPLETED, no summary | Counts as **100** in both aggregates. |
| Never scanned | Renders as **100**, not "unassessed". |

The root enabler is `AssessmentSummary.securityScore Float @default(100)` (`schema.prisma:455`). A nullable score with an explicit `computedAt` removes an entire class of bugs.

### 6.6 Redundant score surfaces

- `dashboard/page.tsx:52` `MetricCard "Security Score"` **and** `:58` `<SecurityScoreChart score={securityScore}/>` — **the same scalar rendered twice**, once as a number and once as a radial gauge.
- `:54` `MetricCard "Projects"` — a count that duplicates the sidebar's Projects entry.
- `:55` `MetricCard "Assessments"` — displays the capped-at-10 number.
- `:60` `<OwaspCoverageRadar coverage={aggregateOwaspCoverage(stats)}/>` — `aggregateOwaspCoverage` (`:24-34`) **averages finding counts per OWASP category** and labels the result "coverage". A project with many API1 findings shows "high coverage" for API1. Semantically inverted: it measures *findings*, not *detection capability*.
- `reports/page.tsx` shows `avgSecurityScore` from the §6.4 formula — a **different number** from the dashboard's for the same data.

### 6.7 Real detection coverage (from the 10 registered plugins)

| OWASP | Checks | Status |
|---|---|---|
| API1:2023 | `bola` | Covered (1) |
| API2:2023 | `broken-authentication`, `jwt-analysis` | Covered (2) |
| API3:2023 | `mass-assignment`, `sensitive-data` | Covered (2) |
| API4:2023 | `rate-limit` | Covered (1) |
| API5:2023 | `bfla` | Covered (1) |
| API7:2023 | `ssrf` | Covered (1) |
| API8:2023 | `cors`, `security-headers`, `sensitive-data` | Covered (3) |
| API6:2023 | — | **Not covered** |
| API9:2023 | — | **Not covered** |
| API10:2023 | — | **Not covered** |

7/10 categories. This table is what "Detection Coverage" should render. (`README.md` matches this; the plugin id is `broken-authentication`, README says `broken-auth` — minor doc drift.)

---

## 7. Frontend inventory

### 7.1 Routes (22 files)

`(auth)`: `login`, `register`, `accept-invite`. `auth/callback`. Root `page.tsx`, `layout.tsx`.

`(dashboard)`: `dashboard`, `projects`, `projects/new`, `projects/[projectId]`, `projects/[projectId]/reports`, `assessments`, `assessments/[assessmentId]`†, `findings`, `findings/[findingId]`†, `reports`, `reports/[reportId]`, `plugins`, `plugins/profiles`, `settings`, **`finance`**.
† untracked / in progress.

Settings is a **single route with `?tab=`** — 9 tabs, no sub-routes.

### 7.2 Data layer

- React Query in **20 files**; `@tanstack/react-query` + devtools + `react-table` installed.
- Single axios client (`lib/api.ts`, 224 lines) — **no duplicate API client**, good.
- JWT from `localStorage`; 401 interceptor clears storage and hard-redirects to `/login`.
- One custom hook only: `hooks/use-mobile.ts`. No `use-sse`, no shared query-key factory.

### 7.3 Shared components that already exist

`layout/`: `PageHeader`, `PageContainer`, `app-sidebar`, `sidebar`, `site-header`, `command-menu`, `theme-switcher`, `themed-toaster`.
`dashboard/`: `MetricCard`, `dashboard-charts`, `recent-assessments-table`.
`tables/`: `data-table`, `data-table-column-header`, `data-table-toolbar`, `data-table-pagination`.
`filters/`: `filter-chips`, `filter-popover`. `assessments/`: `assessment-filters`.
`projects/`: `project-card`†, `project-filters`†, `project-drawer`, `run-assessment-sheet`.
`shared/`: `delete-confirmation-dialog`. `ui/`: `severity-badge`, `empty-state`.

**Empty directories:** `components/examples/`, `components/findings/`.

### 7.4 Duplication & gaps

- **Two paginators**: `ui/pagination.tsx` (used only by `projects/page.tsx`) and `tables/data-table-pagination.tsx` (TanStack). No shared API. Filters/state live in different places per page.
- **Three filter implementations**: `filters/filter-popover` + `filter-chips`, `assessments/assessment-filters`, `projects/project-filters`.
- **`Avatar` primitive exists with ZERO consumers** — nav/user menu does not use it.
- **`Progress` used in exactly one place** (`assessments/[assessmentId]/page.tsx`).
- No `ScanStatusBadge` / `IssueStatusBadge` / `EnvironmentBadge` / `HttpMethodBadge` / `RiskBadge`; only `severity-badge`.
- No `LoadingState` / `ErrorState` / `UnavailableState` (only `empty-state` + `skeleton`).

### 7.5 Mock / hardcoded / backend-less

| Location | Issue |
|---|---|
| `settings/page.tsx:364-383` | `MOCK_TOKENS` — client-only state; "copy" copies the masked placeholder |
| `lib/api.ts:219-224` + `finance/page.tsx` + `nav-data.ts:45` | Finance → 404 |
| `dashboard/page.tsx:24-34` | `aggregateOwaspCoverage` mislabels finding counts as coverage |
| `plugins` page | consumes `/plugins/categories` → 13 categories, 7 empty |

### 7.6 Language mixing — small and contained

7 Spanish strings, all in two files:
- `projects/page.tsx:124,148,222,223,224,225` — "Proyectos", "Crea tu primer proyecto…", "Eliminar proyecto", "Este proyecto, su especificación…", "Cancelar"
- `components/projects/project-filters.tsx:88` — "Filtrar por URL o descripción"

Both are recently-modified/untracked files. Cheap to normalise to English in Phase 0.

### 7.7 Navigation problems

`nav-data.ts`:
- `NAV_MAIN` includes **Finance** (`:45`).
- `NAV_COLLAPSIBLE` **duplicates all 9 Settings tabs into the sidebar** (`:57-71`), which then also render inside the Settings page.
- Labels: "Assessments" → Scans, "Findings" → Issues, "Installed Plugins" → Security Checks.
- `adminOnly` flag exists on Users / Audit Logs — the mechanism is already there.

### 7.8 Command palette — exists, must be extended

`components/layout/command-menu.tsx` (103 lines): `CommandDialog` + Ctrl/Cmd+K (`:34-43`), context provider, navigates from `NAV_MAIN`/`NAV_COLLAPSIBLE`, 2 actions (New Project, Toggle theme).

Missing vs. requirement: entity search (projects/scans/issues/reports), quick actions (Run scan, open critical issues, AI config), `CommandShortcut`, and it inherits Finance from the nav data. **Extend this file — do not create a second palette.**

---

## 8. ReUI / shadcn audit

### 8.1 Registry — configured

`components.json` declares `"registries": { "@reui": "https://reui.io/r/{style}/{name}.json" }`, style `default`, base color `slate`, CSS variables, `lucide` icon library, aliases `@/components`, `@/lib/utils`, `@/components/ui`.

Note a **mixed icon convention**: `iconLibrary: "lucide"` but application code uses `@tabler/icons-react` almost everywhere. Both are installed. Worth standardising (Tabler is the de-facto choice) so `bunx shadcn@latest add` output matches surrounding code.

### 8.2 Installed primitives (34)

`alert-dialog`, `avatar`, `badge`, `breadcrumb`, `button`, `calendar`†, `card`, `chart`, `checkbox`, `collapsible`, `command`, `dialog`, `drawer`, `dropdown-menu`, `empty-state`, `field`, `input`, `label`, `pagination`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `severity-badge`, `sheet`, `sidebar`, `skeleton`, `slider`†, `switch`, `table`, `tabs`, `textarea`, `tooltip`.

**Every primitive the brief requires is already installed.** No new installs are strictly necessary; `ProgressLabel`/`ProgressValue` are the one addition worth pulling from ReUI.

### 8.3 Where each must be reused

| Component | Today | Action |
|---|---|---|
| `command` | `layout/command-menu.tsx`, `project-filters.tsx` | **Extend** the existing palette with real entity search |
| `pagination` | `projects/page.tsx` only | Unify with `data-table-pagination` behind one `PaginationBar` + URL state |
| `progress` | assessment detail only | Wrap in `ScanProgress` bound to SSE + persisted state; add `ProgressLabel`/`ProgressValue` |
| `avatar` | **no consumers** | Adopt in nav user menu, users list, audit logs, assignee, triage activity |
| `alert-dialog` | `delete-confirmation-dialog` | Consolidate as `ConfirmDeleteDialog` |
| `sheet` | `run-assessment-sheet` | Reuse for `IssueQuickViewSheet` |
| `chart` (Recharts) | `dashboard-charts` | Rebuild coverage as matrix/bars; drop the duplicate radial |

---

## 9. Implementation plan

### 9.1 Dependency graph

```
Phase 0 ─────────────────────────────────────┐  (independent, ship first)
                                             │
Phase 1A (schema) → 1B (regen) → 1C (lifecycle) → Phase 2 (score/comparison APIs)
                                             │           │
Phase 3 (shared UI) ──── independent of 1/2 ─┤           │
                                             │           ▼
                                    Phase 4 (Projects/Scans) ─┐
                                             │                ├→ Phase 6 (Dashboard)
                                    Phase 5 (Issues/Triage) ──┘
                                             │
                                    Phase 7 (Reports/Checks/Settings)
                                    Phase 8 (AI enrichment)
```

**Parallelisable now (no domain dependency):** Phase 0, Phase 3, Phase 7's Settings-navigation and Security-Checks renaming, and the i18n normalisation.

**Hard-blocked on the new domain model:** Phase 2 (posture/comparison), Phase 5 (issues/triage), Phase 6 (dashboard), Phase 7's report grouping, Phase 8's per-issue AI persistence.

### 9.2 Units

---

#### **Phase 0 — Security & safeguards** · ~500 LOC · 1–1.5 days

**Scope.** Fail-fast config validation (`ENCRYPTION_KEY`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` — remove all three fallbacks, enforce length, never log). Extract a shared `CryptoService` from `ai-config.service.ts`'s private methods; encrypt `AuthConfig` secrets on write, decrypt only in `scanner.processor`. Stop returning secrets from `saveAuthConfig`. Central `redactSecrets()` applied in `buildRequestString`/`buildResponseString` **and** `LoggingInterceptor`. Move the SSE token off the query string (or redact URLs in logs). Add `RolesGuard`+`@Roles('ADMIN')` to `/ai/config/*`. Guard `SwaggerParser.dereference` against external `$ref`. Hide Finance from nav; delete `MOCK_TOKENS` and show an explicit *unavailable* state; filter `/plugins/categories` to non-empty categories. Normalise the 7 Spanish strings. Delete the two empty component dirs. Add `.env.example`.

**Files.** `config/configuration.ts`, new `common/crypto/crypto.service.ts`, new `common/utils/redact.util.ts`, `ai-config.service.ts`, `projects.service.ts`, `scanner/types/scanner.types.ts`, `scanner.processor.ts`, `common/interceptors/logging.interceptor.ts`, `ai.controller.ts`, `jwt.strategy.ts` + `lib/api.ts`, `nav-data.ts`, `settings/page.tsx`, `plugins.controller.ts`, `projects/page.tsx`, `project-filters.tsx`, `.env.example`.

**Dependencies.** None. **Risks.** Encrypting `AuthConfig` invalidates existing plaintext rows — acceptable (disposable data), but sequence it with 1B. Fail-fast startup will break any environment lacking the three env vars — that is the point; document it.

**Tests.** Config rejects missing/short keys; encrypt→decrypt round-trip; `AuthConfig` ciphertext at rest; `saveAuthConfig` response contains no secret; `redactSecrets` strips Authorization/Cookie/API-key/password; logging interceptor redacts `?token=`; non-admin gets 403 on `/ai/config`; external `$ref` rejected.

**Acceptance.** Backend refuses to start without valid keys. No secret in any DB column, log line, or API response. Finance absent. Zero mock tokens. UI is English-only.

**Review before continuing.** Confirm the fail-fast policy matches how you run locally, and that the SSE auth change doesn't break the assessment detail page.

---

#### **Phase 1A — Target Prisma schema** · ~350 LOC schema · 0.5–1 day

**Scope.** Add `SecurityIssue`, `FindingOccurrence`, `IssueStatusChange`; `IssueStatus` enum; `Project.assetCriticality` (`AssetCriticality` enum); make `AssessmentSummary.securityScore` **nullable** (drop `@default(100)`) and add `computedAt` + scope columns; add ~16 indexes (§2.4); `@@unique([projectId, fingerprint])`; `SecurityIssue → Project` (Cascade), `FindingOccurrence → Assessment` (Cascade), `FindingOccurrence → SecurityIssue` (Cascade); optional `ScanProfilePlugin` join table.

**Files.** `prisma/schema.prisma` only. **Dependencies.** None (design can start immediately, in parallel with Phase 0).

**Risks.** Getting the fingerprint contract wrong is expensive later — settle it here, in writing, before any code.

**Tests.** `prisma validate`, `prisma format`, `prisma generate` clean.

**Acceptance.** Schema validates; every model in §6 of the brief is representable; triage cannot be reached by an assessment cascade.

**Review before continuing.** **This is the highest-leverage review point in the whole plan.** Sign off on the fingerprint contract and the issue/occurrence field split before 1B runs.

---

#### **Phase 1B — Database regeneration** · ~50 LOC + generated SQL · 0.5 day

**Scope.** Drop the dev DB; delete the two stub migrations; generate a real `init` migration containing the full `CREATE TABLE` set + Phase 1A additions; add `migration_lock.toml`; verify `migrate deploy` on an empty DB; extend the seed (system scan profiles, a spec + auth for the demo project so it is genuinely READY, optionally one completed scan).

**Files.** `prisma/migrations/**` (new), `src/prisma/seed.ts`, `docker-compose.yml` (UNVERIFIED whether changes are needed).

**Dependencies.** 1A. **Risks.** Destructive — but you have confirmed the data is disposable. No backfill needed; this is the simplification your "treat it as disposable" decision buys.

**Tests.** From empty: `migrate deploy` → `db:seed` → API boots → plugins auto-sync → demo project is scannable.

**Acceptance.** A fresh clone can build a working DB from migrations alone. `db:reset` works. README Quick Start is accurate.

**Review before continuing.** Confirm the seed's demo fixtures are what you want to demo.

---

#### **Phase 1C — Issue lifecycle backend** · ~900 LOC · 2–3 days

**Scope.** `fingerprint.util.ts` (documented, pure, tested) with path-template normalisation. Add `ruleId` to all 10 plugins + `ScanFinding`. Rewrite `scanner.processor.ts:157-185` into a transactional lifecycle: upsert issue → create occurrence → apply the 6 rules from brief §6.5 → write `IssueStatusChange`. Record executed scope (plugins, rules, endpoints) on the assessment for later scope-aware comparison.

**Files.** new `scanner/fingerprint.util.ts`, new `issues/issue-lifecycle.service.ts`, `scanner.processor.ts`, `scanner.service.ts`, all 10 `plugins/**/*.plugin.ts`, `scanner/types/scanner.types.ts`.

**Dependencies.** 1A + 1B. **Risks.** The largest correctness surface in the reform. Touching all 10 plugins risks regressing detection — keep plugin edits strictly additive (`ruleId` only).

**Tests.** All 8 domain tests from brief §28: same fingerprint twice → 1 issue / 2 occurrences; two rules same plugin+endpoint → 2 issues; RESOLVED reappears → reopen + `reopenCount`++ + history; FALSE_POSITIVE persists; ACCEPTED_RISK unexpired persists / expired → OPEN; unexecuted plugin → not auto-resolved; deleting a scan preserves issue + history.

**Acceptance.** Triage survives rescans and scan deletion. No duplicate issues. Scope is recorded.

**Review before continuing.** Run two real scans against the demo API and inspect the resulting issue/occurrence rows directly.

---

#### **Phase 2 — Score & comparison APIs** · ~900 LOC · 2–3 days

**Scope.** `ScoreService` with three documented, deterministic, tested formulas (assessment / project posture / global posture), each returning an **explanation payload**. Delete the three ad-hoc score computations (§6.1, §6.3, §6.4). Issues API (list/detail/status/assign/note) with server-side pagination + filters. `GET /assessments/:id/comparison?baseline=` with scope intersection and the "scope changed" warning. Rework dashboard aggregation. Standardise the paginated envelope (`data/page/pageSize/total/totalPages`) and the error envelope (`statusCode/code/message/details/requestId`).

**Files.** new `modules/issues/**`, new `modules/scoring/**`, new `modules/comparison/**`, `assessments.service.ts`, `reports.service.ts`, `projects.service.ts`, `http-exception.filter.ts`, `findings.*` (retire).

**Dependencies.** 1C. **Risks.** Formula design is a judgement call — needs your sign-off, not just tests.

**Tests.** Failed scan ≠ 100; unassessed = `null`/unknown, never 100; each project counted once globally; FALSE_POSITIVE/RESOLVED excluded from posture; ACCEPTED_RISK still counted; triage change moves posture; assessment score immutable under later triage; comparison with 10-check baseline vs 3-check current marks the 7 as `NOT_TESTED`, never `resolved`.

**Acceptance.** One score per concept, one implementation each, explainable. Comparison never fabricates resolutions.

**Review before continuing.** Approve the posture formula and its explanation copy.

---

#### **Phase 3 — Shared UI system** · ~1,200 LOC · 2–3 days · **parallel with 1C/2**

**Scope.** Consolidate `PageHeader`/`PageActions`; `MetricCard`/`StatCard`; one `FilterBar`+`FilterPopover`+`FilterChips` with URL state; unify both paginators behind `PaginationBar` (URL / TanStack / server-side); badge family; `Loading`/`Error`/`Empty`/`Unavailable`/`Skeleton` states; `ScanProgress` (SSE + heartbeat + reconnect + polling fallback + refresh recovery); extend the command palette with real search; adopt `Avatar`; `ConfirmDeleteDialog`; `DateRangeFilter`; `ProjectSelector`.

**Files.** `components/layout/**`, `components/tables/**`, `components/filters/**`, `components/shared/**`, `components/ui/**`, new `hooks/use-sse.ts`, `hooks/use-url-filters.ts`, `lib/query-keys.ts`.

**Dependencies.** None for the primitives. `ScanProgress` also needs the Phase 0 SSE auth change and the backend heartbeat/multi-subscriber fix — **schedule that backend SSE fix inside this phase**.

**Risks.** Refactoring `data-table.tsx` touches every table at once.

**Tests.** Filters round-trip through the URL; pagination disables correctly at bounds and resets to page 1 on filter change; palette navigates; progress recovers after refresh; states render.

**Acceptance.** One paginator API, one filter API, one state family. Multiple tabs can watch the same scan.

---

#### **Phase 4 — Projects & Scans** · ~1,600 LOC · 3–4 days

**Scope.** Projects cards (12/page, URL state, criticality, posture, open-issue counts, draft "Step N of 3"). Project Detail as an operations centre with Overview/Endpoints/Scans/Issues/Reports/Configuration. Run Scan sheet: grouped checks, readiness, exact-selection guarantee (fix the silent-filter discrepancy in §4.4). Scans list + Scan Detail in the brief's 7-block order.

**Files.** `(dashboard)/projects/**`, `(dashboard)/assessments/**`, `components/projects/**`, `components/assessments/**`.

**Dependencies.** 2 + 3. **Risks.** Largest frontend surface; the untracked in-progress work here must be reconciled first.

**Tests.** Pagination/filters persist; non-READY project blocks scanning; selected checks == executed checks; progress recovers.

---

#### **Phase 5 — Issues & triage** · ~1,300 LOC · 2–3 days

**Scope.** Issues list (deduplicated, server-side filters), `IssueQuickViewSheet` with the 6 triage actions and their required reasons, Issue Detail with occurrence history and activity timeline, and a hard visual separation between **scanner evidence** and **AI-assisted guidance**.

**Files.** new `(dashboard)/issues/**`, `components/issues/**`; retire `(dashboard)/findings/**`.

**Dependencies.** 2 + 3. **Risks.** Optimistic updates must not desync from lifecycle rules.

**Tests.** Sheet changes status and invalidates queries; five occurrences render as one issue; AI text is never presented as observed evidence.

---

#### **Phase 6 — Dashboard & comparison UI** · ~800 LOC · 1.5–2 days

**Scope.** Rebuild the four first-row cards; delete the duplicate score chart and the Projects redirect card; replace the OWASP radar with a real Detection Coverage matrix (§6.7); risk trend; projects requiring attention; issue lifecycle; recent scans with deltas; comparison summary UI.

**Files.** `(dashboard)/dashboard/page.tsx`, `components/dashboard/**`, new `components/comparison/**`.

**Dependencies.** 2 + 3 (+5 for lifecycle widgets).

**Tests.** Score appears exactly once; coverage reflects installed checks not finding counts; unassessed projects surface as unassessed.

---

#### **Phase 7 — Reports, Security Checks, Settings** · ~1,100 LOC · 2–3 days

**Scope.** Group reports by (assessment, type) with format actions; decide `ReportBundle`+`ReportArtifact` vs. API-level grouping — **and actually persist artifacts**, since today the bytes are discarded (§1.5). Security Checks page (rename, hide empty categories, profiles tab, validated profile writes). Settings: one nav entry, internal tabs, admin-gated sections, real API Tokens backed by the existing `ApiKey` model.

**Files.** `modules/reports/**`, new `modules/api-keys/**`, `plugins/**`, `(dashboard)/reports/**`, `(dashboard)/plugins/**`, `(dashboard)/settings/**`, `nav-data.ts`.

**Dependencies.** 2 (+3). Settings-navigation and the Security-Checks rename can start **in parallel from day one**.

**Tests.** Formats grouped under one entry; token shown once and never re-returned; revoke works; no duplicated Settings nav; empty categories hidden.

---

#### **Phase 8 — AI enrichment & usage** · ~900 LOC · 2–3 days

**Scope.** Versioned playbooks per vulnerability type; richer redacted context; structured output per brief §20; persist provider/model/playbook version/context hash/tokens/cost/confidence/status/sanitised error; retries with backoff; never block scan completion; AI Usage page only once real persistence exists.

**Files.** `modules/ai/**`, new `ai/playbooks/**`, new `AiEnrichment` model (+ migration), `(dashboard)/settings/ai-*`.

**Dependencies.** 1C (per-issue persistence). **Risks.** Provider variability; needs strict schema validation of model output.

**Tests.** AI failure leaves scanner findings intact and surfaces "AI enrichment failed"; AI never mutates severity/status; token usage persists.

---

### 9.3 Totals

| Phase | Diff | Time |
|---|---|---|
| 0 | ~500 | 1–1.5 d |
| 1A | ~350 | 0.5–1 d |
| 1B | ~50 + SQL | 0.5 d |
| 1C | ~900 | 2–3 d |
| 2 | ~900 | 2–3 d |
| 3 | ~1,200 | 2–3 d |
| 4 | ~1,600 | 3–4 d |
| 5 | ~1,300 | 2–3 d |
| 6 | ~800 | 1.5–2 d |
| 7 | ~1,100 | 2–3 d |
| 8 | ~900 | 2–3 d |
| **Total** | **~9,600 LOC** | **~19–27 focused days** |

Sequential critical path: 0 → 1A → 1B → 1C → 2 → 4/5 → 6. Phase 3 runs alongside 1C/2 and shortens the wall-clock by roughly 2–3 days.

### 9.4 If the deadline is tight

Priority order for a defensible capstone: **0 → 1A → 1B → 1C → 2 → 6**, then 3/4/5 as time allows. That sequence delivers the genuine architectural contribution (persistent issue model with lifecycle) and correct, explainable scoring — the two things an examiner will probe — while leaving the visual reform partially deferred but honest.

---

## 10. Verification commands available

`bun run lint` · `bun run test` (jest; currently 1 spec) · `bun run build` · `bun run --cwd apps/web type-check` · `bunx prisma validate` · `bunx prisma migrate deploy`.

**No test infrastructure exists on the frontend** (no vitest/jest/playwright in `apps/web`). Frontend acceptance tests in brief §28 require adding a runner — scope that into Phase 3 or accept manual verification.

---

## 11. Open questions for you

1. **Fingerprint contract** — sign-off needed in Phase 1A. Proposal: `projectId|pluginId|ruleId|METHOD|normalisedPath|component`, with `ruleId` added to all 10 plugins.
2. **Posture formula** — needs your approval, not just tests.
3. **`ruleId` backfill strategy** — plugins emit none today. Derive from title/category, or assign explicit IDs per plugin? The latter is cleaner and is what I'd recommend.
4. **Report artifacts** — persist bytes to disk/DB (true immutability) or keep regenerating from snapshots (simpler)? Affects Phase 7 sizing.
5. **Worker process** — keep in-process (SSE depends on it) or plan for separation now? Recommend keeping in-process and documenting the constraint.
6. **Frontend test runner** — add Vitest + Testing Library, or accept manual verification for UI acceptance criteria?
