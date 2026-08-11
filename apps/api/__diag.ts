import { SQL } from 'bun';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('no DATABASE_URL');
const sql = new SQL(url);

const rows = await sql`
  SELECT p.name                                        AS project,
         a.id                                          AS assessment,
         a."createdAt"                                 AS created,
         s."totalFindings"                             AS summary_total,
         s."criticalCount" + s."highCount" + s."mediumCount"
           + s."lowCount" + s."infoCount"              AS summary_sev_sum,
         (SELECT count(*) FROM finding_occurrences o
           WHERE o."assessmentId" = a.id)              AS occurrences,
         (SELECT count(DISTINCT o."issueId") FROM finding_occurrences o
           WHERE o."assessmentId" = a.id)              AS distinct_issues
  FROM assessments a
  JOIN projects p ON p.id = a."projectId"
  LEFT JOIN assessment_summaries s ON s."assessmentId" = a.id
  WHERE a.status = 'COMPLETED'
  ORDER BY a."createdAt" DESC
  LIMIT 20;
`;

console.log('project'.padEnd(24), 'summary', 'sevSum', 'occurr', 'issues', 'delta');
for (const r of rows) {
  const delta = Number(r.summary_total ?? 0) - Number(r.occurrences);
  console.log(
    String(r.project).slice(0, 23).padEnd(24),
    String(r.summary_total).padStart(7),
    String(r.summary_sev_sum).padStart(6),
    String(r.occurrences).padStart(6),
    String(r.distinct_issues).padStart(6),
    String(delta).padStart(5),
    delta !== 0 ? '  <-- MISMATCH' : '',
  );
}

await sql.end();
