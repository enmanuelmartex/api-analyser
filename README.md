# API Analyser

> Automated API security testing and vulnerability detection platform.
> Scan REST APIs against the OWASP API Security Top 10 in minutes.

<sub>Formerly **IASA** (Intelligent API Security Assessment). The `iasa` identifier
survives in infrastructure contracts — the repository directory, the Postgres
database name, Docker image and container names, and `IASA_*` CI secrets —
because renaming those breaks deployments for no user benefit.</sub>

[![CI](https://github.com/your-org/iasa/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/iasa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun)](https://bun.sh)

---

## Quick Start

```bash
git clone https://github.com/your-org/iasa
cd iasa
cp .env.example .env
bun i
docker compose up -d
bun run db:migrate
bun run db:seed
bun dev
```

Open **http://localhost:3000** and register an account.

> **The seeded accounts do not work for web sign-in.** The web app authenticates
> through Better Auth, which needs a row in the `accounts` table. `bun run db:seed`
> creates `admin@iasa.local` and `analyst@iasa.local` as `users` rows only, so they
> authenticate against the REST API directly (`POST /api/v1/auth/login`) but are
> rejected by the login form. Register through the UI to get a web-usable account.

| Account                | Works for                          |
|------------------------|------------------------------------|
| Registered via the UI  | Web app **and** API                |
| `admin@iasa.local`     | API only — `POST /api/v1/auth/login` |
| `analyst@iasa.local`   | API only — `POST /api/v1/auth/login` |

---

## What It Does

API Analyser automatically assesses REST API security by:

1. **Parsing** OpenAPI/Swagger specifications (URL or file upload)
2. **Discovering** all endpoints, methods, parameters, and schemas
3. **Running** 13 security checks covering all 10 OWASP API Top 10 categories
4. **Analyzing** results with AI — OpenAI, Claude, Gemini, Grok or Ollama (optional)
5. **Generating** reports in PDF, HTML, JSON, SARIF and Markdown

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
iasa/
├── apps/
│   ├── api/                    # NestJS backend (Port 4000)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # JWT authentication
│   │   │   │   ├── projects/       # Project + OpenAPI management
│   │   │   │   ├── assessments/    # Assessment orchestration + SSE
│   │   │   │   ├── findings/       # Vulnerability findings
│   │   │   │   ├── reports/        # HTML/JSON/SARIF/Markdown reports
│   │   │   │   └── scanner/        # Security scanner engine (BullMQ)
│   │   │   │       └── plugins/
│   │   │   │           ├── authentication/  # Broken Auth (API2)
│   │   │   │           ├── authorization/   # BOLA (API1) + BFLA (API5)
│   │   │   │           ├── jwt/             # JWT Analysis
│   │   │   │           ├── rate-limit/      # Rate Limiting (API4)
│   │   │   │           ├── cors/            # CORS Analysis (API8)
│   │   │   │           ├── headers/         # Security Headers (API8)
│   │   │   │           ├── sensitive-data/  # Data Exposure (API3)
│   │   │   │           ├── mass-assignment/ # Mass Assignment (API3)
│   │   │   │           ├── ssrf/            # SSRF (API7)
│   │   │   │           ├── business-flows/  # Sensitive Business Flows (API6)
│   │   │   │           ├── inventory/       # Inventory & Exposure (API9)
│   │   │   │           ├── api-consumption/ # Third-Party Consumption (API10)
│   │   │   │           ├── shared/          # Baseline comparison, tokenising
│   │   │   │           └── ai-analysis/     # OpenAI enrichment
│   │   │   └── prisma/          # Prisma ORM service
│   │   └── prisma/
│   │       └── schema.prisma    # Complete database schema
│   └── web/                     # Next.js 15 frontend (Port 3000)
│       └── src/
│           ├── app/
│           │   ├── (auth)/          # Login, Register
│           │   └── (dashboard)/     # Dashboard, Projects, Assessments, Findings, Reports
│           ├── components/          # Sidebar, badges, charts
│           ├── lib/                 # API client, utilities
│           └── types/               # Shared TypeScript types
├── docker-compose.yml           # Full stack + observability profiles
├── .env.example                 # All environment variables documented
└── .github/
    └── workflows/
        ├── ci.yml               # Lint, test, build Docker images
        └── security.yml         # Security gate + SARIF to GitHub Security
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
| Auth        | JWT (HS256), Passport.js      |
| AI Analysis | OpenAI GPT-4o-mini            |
| Container   | Docker Compose                |
| CI/CD       | GitHub Actions                |

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
# Required
DATABASE_URL=postgresql://iasa:password@localhost:5432/iasa
REDIS_URL=redis://:password@localhost:6379
JWT_SECRET=your-32-char-minimum-secret-here
ENCRYPTION_KEY=your-32-char-encryption-key-here

# Optional — enables AI-powered vulnerability analysis
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

---

## Development

```bash
bun i                     # Install all dependencies
docker compose up -d      # Start PostgreSQL + Redis
bun run db:migrate        # Apply database migrations
bun run db:seed           # Create demo users and project
bun dev                   # Start API (4000) + Web (3000)

# Individual
bun dev:api               # NestJS API only
bun dev:web               # Next.js Web only
bun run db:studio         # Prisma Studio UI
```

---

## CI/CD Security Gate

Block PRs with security issues using IASA GitHub Actions:

```yaml
- name: IASA API Security Gate
  uses: your-org/iasa/.github/workflows/security.yml@main
  with:
    target_url: https://api.yourapp.com
    fail_on: HIGH          # CRITICAL | HIGH | MEDIUM
  secrets:
    IASA_API_KEY: ${{ secrets.IASA_API_KEY }}
```

Results are uploaded to **GitHub Security** as SARIF.

---

## Adding Custom Plugins

```typescript
// apps/api/src/modules/scanner/plugins/my-check/my-check.plugin.ts
import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';

export class MyCheckPlugin extends BasePlugin {
  readonly id = 'my-custom-check';
  readonly name = 'My Security Check';
  readonly description = 'Description of what this checks';
  readonly owaspCategories = ['API8:2023'];

  async run(context: ScanContext): Promise<PluginResult> {
    const findings = [];
    // Implement detection logic using context.endpoints, context.auth, context.baseUrl
    return { pluginId: this.id, pluginName: this.name, findings, scanDuration: 0, endpointsTested: 0 };
  }
}
```

Register it in `scanner.service.ts` — it runs automatically in every assessment.

---

## Security Notice

> **IASA is designed for authorized security testing only.**
> Only use it against APIs you own or have explicit written permission to test.
> Unauthorized API testing may violate computer fraud laws and regulations.

---

*IASA v0.1.0 — Intelligent System for API Security Assessment Based on Automated Testing and Vulnerability Detection*
*University Cybersecurity Capstone Project*