# API Analyser

> Automated API security testing and vulnerability detection platform.
> Scan REST APIs against the OWASP API Security Top 10 in minutes.

<sub>Formerly **IASA** (Intelligent System for API Security Assessment). The rename
went all the way down for v1.0 — repository, packages, containers, database,
environment variables and CI secrets. If you are upgrading a clone from before
the rename, see [Upgrading from IASA](#upgrading-from-iasa).</sub>

[![CI](https://github.com/enmanuelmartex/api-analyser/actions/workflows/ci.yml/badge.svg)](https://github.com/enmanuelmartex/api-analyser/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun)](https://bun.sh)

---

## Quick Start

Two supported ways to run it. Pick the first unless you intend to change the code.

### 1 · With Docker — recommended

Brings up PostgreSQL, Redis, the API and the web app together, on one network,
already wired to each other. Nothing else is installed on your machine, and no
`.env` is required.

```bash
git clone https://github.com/enmanuelmartex/api-analyser
cd api-analyser
docker compose up -d
```

The first run builds the images and takes a few minutes. Watch it come up with
`docker compose logs -f api`.

### 2 · From source

For working on the code — the API and the web app run on your machine with hot
reload, while the data stores still come from Docker.

```bash
git clone https://github.com/enmanuelmartex/api-analyser
cd api-analyser
bun run setup:env               # .env from .env.example, with generated secrets
docker compose up -d postgres redis
bun install
bun run db:migrate
bun dev
```

`setup:env` exists because the API refuses to start on a missing or placeholder
secret — see [Environment Variables](#environment-variables). If you already run
your own PostgreSQL and Redis, skip the compose line and edit `DATABASE_URL` and
`REDIS_URL` in `.env`.

### Then sign in

Open **http://localhost:3000** — the API is on **:4000**, and its interactive
documentation on **http://localhost:4000/api/docs** (the OpenAPI document itself
is at `/api/docs-json`, or `/api/docs-yaml`). Both come up whichever way you
started the stack; set `SWAGGER_ENABLED=false` to turn them off.

| | |
|---|---|
| **User** | `admin@apianalyser.local` |
| **Password** | `admin1234` |

The API creates that administrator the first time it starts against an empty
database, and that account creates every other one from **Settings → Users**.
There is no public sign-up and no OAuth: this is self-hosted software on your
own network, in the shape of Wazuh or Grafana.

> **Change the password.** Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the
> first start to pick your own, or change it in the UI afterwards. The bootstrap
> only ever runs against an empty user table, so it will not resurrect a deleted
> admin or reset a changed password — but the API logs a warning on every boot
> while the default is still in use.

---

## What It Does

API Analyser automatically assesses REST API security by:

1. **Parsing** OpenAPI/Swagger specifications (URL or file upload)
2. **Discovering** all endpoints, methods, parameters, and schemas
3. **Running** 13 security checks covering all 10 OWASP API Top 10 categories
4. **Analyzing** results with AI — OpenAI, Claude, Gemini, Groq or Ollama (optional)
5. **Generating** reports in PDF, HTML, JSON, SARIF and Markdown. Every scan that
   completes gets its PDF automatically — rendered on a queue, retried three
   times with backoff, and never marked ready until the bytes are on disk. The
   other formats are exported on request. PDF is the one format that needs a
   headless Chromium: the Docker image ships one, and a from-source run uses the
   Chrome, Edge or Chromium already installed (or `CHROMIUM_EXECUTABLE_PATH`).
   The API logs which renderer it found at boot.
6. **Scheduling** those assessments to run on their own — hourly, daily, weekly,
   monthly or on a cron expression, in the timezone you configure. Scheduled
   scans run entirely on the server: they keep going with the browser closed and
   survive a restart of the API, the worker or Redis. See
   [apps/api/src/modules/scheduled-scans](apps/api/src/modules/scheduled-scans).
7. **Telling you** what happened — persistent in-app notifications with unread
   badges on the sidebar, live over SSE. Everything is stored, so a scan that
   finishes at 3 a.m. is waiting for you at 8. See
   [apps/api/src/modules/notifications](apps/api/src/modules/notifications).

---

## OWASP API Security Top 10 (2023) Coverage

**13 security checks · 49 rules · 10 of 10 categories covered.**

Coverage is computed from the check manifests at runtime
(`GET /api/v1/plugins/owasp-coverage`) and asserted in
`apps/api/src/modules/plugins/owasp-coverage.spec.ts`, so this table cannot
quietly drift from the code.

| ID         | Category                                | Status      | Security check                       |
|------------|-----------------------------------------|-------------|--------------------------------------|
| API1:2023  | Broken Object Level Authorization       | Covered     | `bola`                               |
| API2:2023  | Broken Authentication                   | Covered     | `broken-authentication`, `jwt-analysis` |
| API3:2023  | Broken Object Property Level Auth       | Covered     | `mass-assignment`, `sensitive-data`  |
| API4:2023  | Unrestricted Resource Consumption       | Covered     | `rate-limit`                         |
| API5:2023  | Broken Function Level Authorization     | Covered     | `bfla`                               |
| API6:2023  | Unrestricted Access to Sensitive Business Flows | Covered † | `business-flows`             |
| API7:2023  | Server Side Request Forgery             | Covered     | `ssrf`                               |
| API8:2023  | Security Misconfiguration               | Covered     | `cors`, `security-headers`, `sensitive-data` |
| API9:2023  | Improper Inventory Management           | Covered †   | `inventory`                          |
| API10:2023 | Unsafe Consumption of APIs              | Covered †   | `api-consumption`                    |

**† Covered is not the same as exhaustive.** Three categories describe more than
a black-box scan can see, and their checks say where they stop. The limits are
carried in the coverage API, the UI and every report — not only here.

- **API6** — flows are identified from the naming in the specification, and each
  finding names the term that matched so the classification can be judged. A
  flow named in terms the vocabulary does not recognise is not examined. What is
  observed is the absence of a control in front of the flow: no throttle, no bot
  mitigation, no captcha or OTP field, no authentication, no idempotency key.
  Probes carry a payload the target is expected to reject, so the flow itself is
  not executed, and DELETE operations are never probed.
- **API9** — probing is confined to the host under assessment: undocumented
  versions beside the documented ones, deprecated operations still answering,
  and exposed documentation, actuator, metrics and debug surfaces. Every claim
  is made against a baseline request to a path that does not exist, so a host
  with a catch-all route produces no findings. A shadow API on a *different*
  hostname cannot be found this way — that needs an asset inventory the scanner
  is not given, and probing hosts nobody nominated would be scanning something
  nobody authorised.
- **API10** — only what crosses the client boundary is observable: upstream
  references returned over plain HTTP, upstream errors relayed verbatim, and
  inbound webhooks that accept unverified senders. Whether the service validates
  what its upstreams return cannot be settled from outside; that needs code or
  egress analysis.

A tick with a footnote is the honest shape of these three. A tick without one
would claim more than the product can demonstrate, and no check at all left
users reading "no findings" as "nothing to find".

---

## Architecture

```
api-analyser/
├── apps/
│   ├── api/                    # NestJS backend (Port 4000)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/            # Better Auth session + JWT/bearer auth, admin bootstrap
│   │   │   │   ├── users/           # User CRUD, roles
│   │   │   │   ├── projects/        # Project + OpenAPI/Swagger management
│   │   │   │   ├── assessments/     # Assessment orchestration + SSE progress
│   │   │   │   ├── scheduled-scans/ # Recurring scans (BullMQ tick → createAndRun)
│   │   │   │   │   └── recurrence/  # Timezone-aware next-run engine + cron parser
│   │   │   │   ├── issues/          # Findings lifecycle (status, occurrences, dedup)
│   │   │   │   ├── scoring/         # Assessment security score + run-to-run comparison
│   │   │   │   ├── reports/         # PDF/HTML/JSON/SARIF/Markdown report generation
│   │   │   │   ├── scanner/         # Security scanner engine (BullMQ)
│   │   │   │   │   └── plugins/
│   │   │   │   │       ├── authentication/  # Broken Auth (API2)
│   │   │   │   │       ├── authorization/   # BOLA (API1) + BFLA (API5)
│   │   │   │   │       ├── jwt/             # JWT Analysis
│   │   │   │   │       ├── rate-limit/      # Rate Limiting (API4)
│   │   │   │   │       ├── cors/            # CORS Analysis (API8)
│   │   │   │   │       ├── headers/         # Security Headers (API8)
│   │   │   │   │       ├── sensitive-data/  # Data Exposure (API3)
│   │   │   │   │       ├── mass-assignment/ # Mass Assignment (API3)
│   │   │   │   │       ├── ssrf/            # SSRF (API7)
│   │   │   │   │       ├── business-flows/  # Sensitive Business Flows (API6)
│   │   │   │   │       ├── inventory/       # Inventory & Exposure (API9)
│   │   │   │   │       ├── api-consumption/ # Third-Party Consumption (API10)
│   │   │   │   │       └── shared/          # Baseline comparison, tokenising
│   │   │   │   ├── ai/               # Pluggable AI enrichment (OpenAI, Groq, Claude, Gemini, Ollama)
│   │   │   │   ├── plugins/          # Plugin registry + OWASP coverage computation
│   │   │   │   ├── notifications/    # In-app notifications, live over SSE
│   │   │   │   ├── audit/            # Audit log, retention, live stream
│   │   │   │   ├── settings/         # System settings
│   │   │   │   ├── events/           # Internal domain events
│   │   │   │   └── system/           # Health checks, boot diagnostics
│   │   │   └── prisma/          # Prisma ORM service
│   │   └── prisma/
│   │       └── schema.prisma    # Complete database schema
│   └── web/                     # Next.js 15 frontend (Port 3000)
│       └── src/
│           ├── app/
│           │   ├── (auth)/          # Login, Register
│           │   └── (dashboard)/     # Dashboard, Projects, Assessments, Issues, Scheduled scans,
│           │                        # Reports, Plugins, Notifications, Settings
│           ├── components/          # Sidebar, badges, charts
│           ├── lib/                 # API client, utilities
│           └── types/               # Shared TypeScript types
├── docker-compose.yml           # Full stack + observability profiles (Prometheus, Grafana)
├── .env.example                 # All environment variables documented
└── .github/
    └── workflows/
        ├── ci.yml               # Lint, test, build Docker images
        └── security.yml         # Security gate template — see CI/CD Security Gate below
```

---

## Tech Stack

| Layer       | Technology                    |
|-------------|-------------------------------|
| Runtime     | **Bun 1.x**                   |
| Frontend    | Next.js 15, TypeScript, React 19 |
| UI          | Tailwind CSS, Shadcn/UI, Recharts |
| Backend     | NestJS 10, TypeScript         |
| Database    | PostgreSQL 16 + Prisma ORM    |
| Queue       | Redis 7 + BullMQ              |
| Auth        | Better Auth, JWT (HS256), Passport.js |
| AI Analysis | OpenAI, Groq, Claude, Gemini, or local Ollama — pluggable via `AI_PROVIDER` |
| Container   | Docker Compose                |
| CI/CD       | GitHub Actions                |

---

## Environment Variables

**With Docker you can skip this entirely.** The entrypoint generates the four
secrets on first boot and keeps them on the `api_secrets` volume, so every
install gets its own and none is published here. Set any of them yourself and
yours is used instead.

**From source**, run `bun run setup:env` — it copies `.env.example` and fills the
same four with `crypto.randomBytes`. It refuses to overwrite an existing `.env`,
because `ENCRYPTION_KEY` decrypts stored target credentials and regenerating it
strands all of them.

```bash
# Required — the API refuses to start without these
DATABASE_URL=postgresql://api_analyser:password@localhost:5432/api_analyser
REDIS_URL=redis://:password@localhost:6379
JWT_SECRET=<64 hex chars>            # openssl rand -hex 32
REFRESH_TOKEN_SECRET=<64 hex chars>  # must differ from JWT_SECRET
ENCRYPTION_KEY=<64 hex chars>        # exactly 64 hex, AES-256-GCM

# The first administrator, created only while the user table is empty
ADMIN_EMAIL=admin@apianalyser.local
ADMIN_PASSWORD=admin1234

# Optional — enables AI-powered vulnerability analysis. Pick one provider; the
# rest can be left blank. Each provider also has tuning vars under its own
# prefix (OPENAI_*, GROQ_*, CLAUDE_*, GEMINI_*, OLLAMA_*) — see .env.example
# for the full list. Providers can also be configured from the UI at
# Settings → AI Configuration, which takes priority over these env vars.
AI_PROVIDER=none              # openai | grok | claude | gemini | ollama | none
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Optional — Swagger UI at /api/docs and the OpenAPI document at /api/docs-json.
# On by default, in every NODE_ENV; set to false to stop serving them.
SWAGGER_ENABLED=true

```

A placeholder is rejected on purpose: `validateEnv` fails the boot on any secret
containing `change-in-production`, on anything under 32 characters, and on an
`ENCRYPTION_KEY` that is not exactly 64 hexadecimal characters.

---

## Development

```bash
bun run setup:env         # .env with generated secrets (once)
bun i                     # Install all dependencies
docker compose up -d postgres redis
bun run db:migrate        # Apply database migrations
bun dev                   # Start API (4000) + Web (3000)

# Individual
bun dev:api               # NestJS API only
bun dev:web               # Next.js Web only
bun run db:studio         # Prisma Studio UI
bun run db:seed           # Optional: a demo PetStore project to scan

# Checks — the same three CI runs
bun run lint              # API + web
bun run --cwd apps/api type-check
bun test                  # API + web suites
```

`db:seed` no longer creates accounts. It attaches a demo project to the
administrator that already exists, so start the API at least once before running
it.

---

## Upgrading from IASA

The v1.0 rename replaced the `iasa` identifier everywhere it appeared, including
places a running environment holds onto. A fresh clone needs none of this; an
existing one needs all of it.

**The database.** The Postgres role and database are now `api_analyser`. The
container will not rename an existing volume, so a dev environment created before
the rename still holds a database called `iasa` that the new `DATABASE_URL` does
not point at. Either keep your old values in `.env` — nothing forces the new
names on you — or start clean:

```bash
docker compose down -v    # destroys the local volumes and their data
docker compose up -d      # fresh volumes, fresh secrets, fresh admin
```

**Everything else.**

| Was | Is now |
|-----|--------|
| `github.com/enmanuelmartex/iasa` | `github.com/enmanuelmartex/api-analyser` (the old URL redirects) |
| `@iasa/api`, `@iasa/web` | `@api-analyser/api`, `@api-analyser/web` |
| containers `iasa-*`, network `iasa-network` | `api-analyser-*`, `api-analyser-network` |
| Postgres role/db `iasa`, test db `iasa_test` | `api_analyser`, `api_analyser_test` |
| `admin@iasa.local`, `analyst@iasa.local` | `admin@apianalyser.local`, `analyst@apianalyser.local` |
| CI secret `IASA_API_KEY` | `API_ANALYSER_API_KEY` |

Old containers, volumes and networks are not removed by any of this — clean them
up with `docker rm`/`docker volume rm` once you no longer need the data.

Everything the product shows a user was already branded **API Analyser** before
this rename, and `brand.spec.ts` in each app fails if the old name reappears
there. What changed is the plumbing underneath.

---

## CI/CD Security Gate (planned)

The shape of a PR gate — a reusable workflow that fails the build on findings
at or above a chosen severity, with results uploaded to **GitHub Security** as
SARIF:

```yaml
- name: API Analyser API Security Gate
  uses: enmanuelmartex/api-analyser/.github/workflows/security.yml@main
  with:
    target_url: https://api.yourapp.com
    fail_on: HIGH          # CRITICAL | HIGH | MEDIUM
  secrets:
    API_ANALYSER_API_KEY: ${{ secrets.API_ANALYSER_API_KEY }}
```

**Not usable yet, on purpose.** [.github/workflows/security.yml](.github/workflows/security.yml)
today is a template: it has no `workflow_call` trigger, so nothing can `uses:`
it as shown above, and its scan step is commented out. Running an assessment
from CI also needs a programmatic API key, and issuing one is not implemented
— Settings → API tokens says exactly that in the UI. This section describes
where the gate is headed, not something to wire up today; every scan currently
runs through the web app.

---

## Adding Custom Plugins

A plugin declares a `manifest` — its metadata, OWASP mappings and every
`ruleId` it can emit — and implements one `run` method:

```typescript
// apps/api/src/modules/scanner/plugins/my-check/my-check.plugin.ts
import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';

export class MyCheckPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'my-custom-check',
    name: 'My Security Check',
    version: '1.0.0',
    description: 'Description of what this checks',
    author: 'your-name',
    license: 'MIT',
    category: PluginCategory.API_DESIGN,
    owaspMappings: ['API8:2023'],
    tags: ['custom'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'findings:write'],
    minimumCoreVersion: '1.0.0',
    isBuiltin: false,
    ruleNamespace: 'my-custom-check',
    ruleIds: ['my-custom-check.some-rule'], // every ruleId this plugin can emit, declared up front
  };

  async run(context: ScanContext): Promise<PluginResult> {
    const findings = [];
    // Implement detection logic using context.endpoints, context.auth, context.baseUrl
    return { pluginId: this.manifest.id, pluginName: this.manifest.name, findings, scanDuration: 0, endpointsTested: 0 };
  }
}
```

Register an instance of it in the array returned by `createBuiltinPlugins()` in
[apps/api/src/modules/plugins/plugin-registry.service.ts](apps/api/src/modules/plugins/plugin-registry.service.ts)
— it then runs automatically in every assessment.

---

## Security Notice

> **API Analyser is designed for authorized security testing only.**
> Only use it against APIs you own or have explicit written permission to test.
> Unauthorized API testing may violate computer fraud laws and regulations.

---

*API Analyser v0.1.0 — Automated API security assessment and vulnerability detection*
*University Cybersecurity Capstone Project*