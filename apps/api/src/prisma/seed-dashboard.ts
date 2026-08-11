/**
 * Dashboard demo seed.
 *
 * Populates realistic data for the three dashboard analytics cards so they can
 * be validated visually against the REAL backend queries:
 *
 *   • Overall Security Score  — completed assessments across Jan–Dec of the
 *     current year, with months that have several / one / zero assessments and
 *     up-and-down monthly averages (drives `getScoreTrend`).
 *   • Findings by Severity     — real `FindingOccurrence` rows spread across the
 *     last 8 weeks plus the previous 8 weeks, split by severity (drives
 *     `getFindingsTrend`).
 *   • OWASP API Top 10 Coverage — `summary.owaspCoverage` maps on the most
 *     recent assessments (drives `aggregateOwaspCoverage`).
 *
 * Nothing here is hardcoded into the frontend: the charts keep reading from the
 * dashboard endpoint. This only writes rows into the database.
 *
 * Development / testing ONLY. Idempotent and repeatable: each run RESETS only
 * this seed's own data — everything under the "Dashboard Demo Project" — inside
 * a transaction and recreates it deterministically. It never deletes or mutates
 * projects, assessments or findings created by a real user.
 *
 * Run (from apps/api):   bun run seed:dashboard
 * Attach to a specific account:  SEED_DASHBOARD_EMAIL=you@example.com bun run seed:dashboard
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

const DEMO = {
  projectId: 'seed-dashboard-project',
  projectName: 'Dashboard Demo Project',
  userEmail: process.env.SEED_DASHBOARD_EMAIL ?? 'admin@apianalyser.local',
  /** Only used if the target user does not exist yet. */
  fallbackPassword: 'Admin@123!',
} as const;

const OWASP_IDS = [
  'API1:2023', 'API2:2023', 'API3:2023', 'API4:2023', 'API5:2023',
  'API6:2023', 'API7:2023', 'API8:2023', 'API9:2023', 'API10:2023',
] as const;

/** Varied 20–95 base coverage so the radar has a real shape, not a centre dot. */
const OWASP_BASE: Record<string, number> = {
  'API1:2023': 90, 'API2:2023': 78, 'API3:2023': 45, 'API4:2023': 62, 'API5:2023': 30,
  'API6:2023': 55, 'API7:2023': 85, 'API8:2023': 70, 'API9:2023': 40, 'API10:2023': 25,
};

/**
 * Monthly average security scores, by month index (0 = January). Designed to
 * exercise every state of the year chart:
 *   Jan 3 scans (medium) → Feb up → Mar down → Apr EMPTY → May varied 3 scans →
 *   Jun 2 scans → Jul 3 scans (up vs Jun, so the header badge is positive).
 * Months not listed (and any month after the current one) stay empty.
 */
const MONTHLY_SCORES: Record<number, number[]> = {
  0: [50, 55, 58],
  1: [66, 72],
  2: [46, 52],
  4: [38, 70, 60],
  5: [58, 62],
  6: [70, 74, 72],
};

/**
 * Findings per visible week (index 0 = oldest W1 … 7 = newest W8), by severity.
 * W2 is intentionally empty; W8 carries every severity including criticals; the
 * totals rise and fall week to week.
 */
const WEEKLY_FINDINGS: Record<number, Partial<Record<Sev, number>>> = {
  0: { LOW: 2, INFO: 1 },
  2: { MEDIUM: 2, LOW: 1 },
  3: { HIGH: 1, MEDIUM: 2, LOW: 2 },
  4: { MEDIUM: 1, LOW: 1 },
  5: { HIGH: 2, MEDIUM: 2, LOW: 1, INFO: 1 },
  6: { CRITICAL: 1, HIGH: 1, MEDIUM: 1 },
  7: { CRITICAL: 2, HIGH: 2, MEDIUM: 1, LOW: 1, INFO: 1 },
};

/**
 * How many detections to place in the previous 8-week period. Kept below the
 * visible-period total (29) so findings read as INCREASING — the inverted
 * severity badge should therefore show a red / negative trend.
 */
const PREVIOUS_PERIOD_TOTAL = 18;

/** One representative persistent issue per (severity, OWASP category). */
const DEMO_ISSUES: Array<{ id: string; severity: Sev; owasp: string; title: string; ruleId: string; route: string; component: string }> = [
  { id: 'seed-dashboard-issue-crit-api1', severity: 'CRITICAL', owasp: 'API1:2023', title: 'Broken object level authorization on order lookup', ruleId: 'bola-idor', route: '/store/order/{id}', component: 'path:id' },
  { id: 'seed-dashboard-issue-crit-api5', severity: 'CRITICAL', owasp: 'API5:2023', title: 'Admin endpoint reachable without role check', ruleId: 'bfla-admin', route: '/admin/users', component: 'endpoint' },
  { id: 'seed-dashboard-issue-high-api2', severity: 'HIGH', owasp: 'API2:2023', title: 'JWT accepted with alg=none', ruleId: 'auth-jwt-alg-none', route: '/user/login', component: 'header:authorization' },
  { id: 'seed-dashboard-issue-high-api8', severity: 'HIGH', owasp: 'API8:2023', title: 'Security headers missing', ruleId: 'misconfig-headers', route: '/', component: 'response:headers' },
  { id: 'seed-dashboard-issue-med-api3', severity: 'MEDIUM', owasp: 'API3:2023', title: 'Mass assignment on profile update', ruleId: 'bopla-mass-assignment', route: '/user/{id}', component: 'body:role' },
  { id: 'seed-dashboard-issue-med-api4', severity: 'MEDIUM', owasp: 'API4:2023', title: 'No rate limiting on search', ruleId: 'resource-rate-limit', route: '/pet/findByStatus', component: 'endpoint' },
  { id: 'seed-dashboard-issue-low-api7', severity: 'LOW', owasp: 'API7:2023', title: 'Server-side request forgery hint in webhook URL', ruleId: 'ssrf-webhook', route: '/webhooks', component: 'body:url' },
  { id: 'seed-dashboard-issue-low-api9', severity: 'LOW', owasp: 'API9:2023', title: 'Deprecated API version still served', ruleId: 'inventory-deprecated', route: '/v1/pet', component: 'endpoint' },
  { id: 'seed-dashboard-issue-info-api10', severity: 'INFO', owasp: 'API10:2023', title: 'Third-party API called over plain HTTP', ruleId: 'unsafe-consumption-http', route: '/integrations/sync', component: 'endpoint' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const PLUGIN_ID = 'seed-dashboard-plugin';
const PLUGIN_VERSION = '1.0.0';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function riskFromScore(score: number): string {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}

/** Per-assessment OWASP coverage: the base profile nudged so categories end up
 *  with more than one contributing result that averages back to the profile. */
function owaspCoverageFor(globalIndex: number): Record<string, number> {
  const offset = ((globalIndex % 5) - 2) * 3; // -6 … +6
  const map: Record<string, number> = {};
  for (const id of OWASP_IDS) map[id] = clamp(Math.round(OWASP_BASE[id] + offset), 5, 100);
  return map;
}

function methodOf(route: string): string {
  return route.includes('login') ? 'POST' : 'GET';
}

async function resolveTargetUser() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO.userEmail } });
  if (existing) return { user: existing, created: false };
  const password = await bcrypt.hash(DEMO.fallbackPassword, 12);
  const user = await prisma.user.create({
    data: { email: DEMO.userEmail, name: 'Dashboard Demo User', password, role: 'ADMIN', emailVerified: true },
  });
  return { user, created: true };
}

async function main() {
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' && process.env.FORCE_DASHBOARD_SEED !== 'true') {
    console.error('✖ Refusing to run the dashboard demo seed with NODE_ENV=production.');
    console.error('  This seed is for development/testing only. Set FORCE_DASHBOARD_SEED=true to override.');
    process.exit(1);
  }

  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = now.getMonth();

  const { user, created: userCreated } = await resolveTargetUser();

  // Idempotent project: created once, never deleted, reused on every run.
  await prisma.project.upsert({
    where: { id: DEMO.projectId },
    // userId is updated too, so re-running with a different SEED_DASHBOARD_EMAIL
    // re-homes the demo data to the account you actually log in with.
    update: { name: DEMO.projectName, isActive: true, status: 'READY', userId: user.id },
    create: {
      id: DEMO.projectId,
      name: DEMO.projectName,
      description: 'Synthetic data for validating the dashboard analytics charts. Safe to delete.',
      baseUrl: 'https://demo.dashboard.local',
      environment: 'DEVELOPMENT',
      assetCriticality: 'MEDIUM',
      tags: ['seed-dashboard', 'demo'],
      isActive: true,
      status: 'READY',
      setupStep: 3,
      userId: user.id,
    },
  });

  // ── Build the assessment / summary rows (score trend + OWASP coverage) ──────
  type AssessmentSeed = { id: string; monthIndex: number; completedAt: Date; score: number; owasp: Record<string, number> };
  const assessmentSeeds: AssessmentSeed[] = [];
  let globalIndex = 0;
  for (const [monthKey, scores] of Object.entries(MONTHLY_SCORES)) {
    const monthIndex = Number(monthKey);
    if (monthIndex > currentMonth) continue; // never seed a future month of this year
    scores.forEach((score, i) => {
      const day = clamp(4 + i * 8, 1, 27);
      const completedAt = new Date(year, monthIndex, day, 10, 0, 0);
      assessmentSeeds.push({ id: `seed-dashboard-asmt-${monthIndex}-${i}`, monthIndex, completedAt, score, owasp: owaspCoverageFor(globalIndex) });
      globalIndex += 1;
    });
  }
  // Findings occurrences hang off the newest completed assessment.
  const findingsAssessmentId = assessmentSeeds[assessmentSeeds.length - 1]?.id;
  if (!findingsAssessmentId) throw new Error('No assessments to seed — check MONTHLY_SCORES.');

  // ── Build the finding occurrences (weekly trend + previous period) ──────────
  const issueBySeverity = new Map<Sev, (typeof DEMO_ISSUES)[number]>();
  for (const issue of DEMO_ISSUES) if (!issueBySeverity.has(issue.severity)) issueBySeverity.set(issue.severity, issue);

  type OccurrenceSeed = { severity: Sev; detectedAt: Date };
  const occurrenceSeeds: OccurrenceSeed[] = [];
  // Visible weeks: index 0 = W1 (oldest) … 7 = W8 (newest). Offset lands mid-week.
  for (const [weekKey, counts] of Object.entries(WEEKLY_FINDINGS)) {
    const weekIndex = Number(weekKey);
    const offsetDays = (7 - weekIndex) * 7 + 3;
    for (const [severity, count] of Object.entries(counts)) {
      for (let n = 0; n < (count ?? 0); n += 1) {
        occurrenceSeeds.push({ severity: severity as Sev, detectedAt: new Date(now.getTime() - offsetDays * DAY_MS - n * 3600_000) });
      }
    }
  }
  const visibleCount = occurrenceSeeds.length;
  // Previous 8-week period: offsets strictly between 56 and 112 days ago.
  const prevSeverities: Sev[] = ['LOW', 'MEDIUM', 'HIGH', 'INFO', 'MEDIUM', 'LOW'];
  for (let k = 0; k < PREVIOUS_PERIOD_TOTAL; k += 1) {
    const offsetDays = 63 + (k % 6) * 7; // 63 … 98
    occurrenceSeeds.push({ severity: prevSeverities[k % prevSeverities.length], detectedAt: new Date(now.getTime() - offsetDays * DAY_MS) });
  }

  // ── Reset + recreate this seed's data only, atomically ──────────────────────
  await prisma.$transaction(
    async (tx) => {
      // Scoped strictly to the demo project. Cascades remove summaries and the
      // occurrences hanging off these assessments/issues. User data is untouched.
      await tx.findingOccurrence.deleteMany({ where: { assessment: { projectId: DEMO.projectId } } });
      await tx.assessment.deleteMany({ where: { projectId: DEMO.projectId } });
      await tx.securityIssue.deleteMany({ where: { projectId: DEMO.projectId } });

      for (const seed of assessmentSeeds) {
        await tx.assessment.create({
          data: {
            id: seed.id,
            projectId: DEMO.projectId,
            status: 'COMPLETED',
            progress: 100,
            startedAt: new Date(seed.completedAt.getTime() - 5 * 60 * 1000),
            completedAt: seed.completedAt,
            createdAt: seed.completedAt,
            duration: 300,
            summary: {
              create: {
                totalEndpoints: 12,
                testedEndpoints: 12,
                totalFindings: 0,
                securityScore: seed.score,
                scoreStatus: 'FINAL',
                scoreVersion: 'score-v1',
                scoreComputedAt: seed.completedAt,
                riskLevel: riskFromScore(seed.score),
                owaspCoverage: seed.owasp,
              },
            },
          },
        });
      }

      await tx.securityIssue.createMany({
        data: DEMO_ISSUES.map((issue) => ({
          id: issue.id,
          projectId: DEMO.projectId,
          fingerprint: `seed-dashboard|${issue.id}`,
          pluginId: PLUGIN_ID,
          ruleId: issue.ruleId,
          method: methodOf(issue.route),
          normalizedRoute: issue.route,
          component: issue.component,
          title: issue.title,
          description: `Demo finding for the ${issue.owasp} category. Synthetic data for dashboard validation.`,
          severity: issue.severity,
          owaspCategory: issue.owasp,
          status: 'OPEN',
        })),
      });

      await tx.findingOccurrence.createMany({
        data: occurrenceSeeds.map((occ, index) => {
          const issue = issueBySeverity.get(occ.severity) ?? DEMO_ISSUES[0];
          return {
            id: `seed-dashboard-occ-${index}`,
            issueId: issue.id,
            assessmentId: findingsAssessmentId,
            occurrenceKey: `seed-dashboard-occ-${index}`,
            methodSnapshot: methodOf(issue.route),
            pathSnapshot: issue.route,
            pluginIdSnapshot: PLUGIN_ID,
            pluginVersionSnapshot: PLUGIN_VERSION,
            ruleIdSnapshot: issue.ruleId,
            severitySnapshot: occ.severity,
            owaspSnapshot: issue.owasp,
            titleSnapshot: issue.title,
            descriptionSnapshot: `Detected on ${occ.detectedAt.toISOString().slice(0, 10)} (demo).`,
            location: issue.component,
            detectedAt: occ.detectedAt,
            createdAt: occ.detectedAt,
          };
        }),
      });
    },
    { timeout: 60_000 },
  );

  // ── Console summary ─────────────────────────────────────────────────────────
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const perMonth = assessmentSeeds.reduce<Record<number, number>>((acc, seed) => {
    acc[seed.monthIndex] = (acc[seed.monthIndex] ?? 0) + 1;
    return acc;
  }, {});
  const monthBreakdown = Object.keys(perMonth)
    .map(Number)
    .sort((a, b) => a - b)
    .map((m) => `${monthNames[m]}×${perMonth[m]}`)
    .join(', ');

  console.log('');
  console.log('✔ Dashboard demo seed complete  (development data only)');
  console.log('──────────────────────────────────────────────────────');
  console.log(`  target user        ${user.email}${userCreated ? '  (created — password: ' + DEMO.fallbackPassword + ')' : '  (existing)'}`);
  console.log(`  demo project       ${DEMO.projectName} (${DEMO.projectId})`);
  console.log(`  assessments        ${assessmentSeeds.length} completed in ${year}  [${monthBreakdown}]  (Apr and future months intentionally empty)`);
  console.log(`  security issues    ${DEMO_ISSUES.length} (all severities across API1–API10)`);
  console.log(`  findings (visible) ${visibleCount} detections across the last 8 weeks (W2 empty, W8 has criticals)`);
  console.log(`  findings (previous)${PREVIOUS_PERIOD_TOTAL} in the prior 8 weeks → visible period is higher → red trend badge`);
  console.log(`  OWASP coverage     averaged from the ${Math.min(5, assessmentSeeds.length)} most recent assessments (varied 20–95%)`);
  console.log('──────────────────────────────────────────────────────');
  console.log(`  Sign in as ${user.email} to see the demo dashboard. Re-run any time to reset it.`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('Dashboard seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
