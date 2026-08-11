import { SQL } from 'bun';

const sql = new SQL(process.env.DATABASE_URL!);

const targets = await sql`
  SELECT a.id, p.name, s."totalFindings" AS total,
         (SELECT count(*) FROM finding_occurrences o WHERE o."assessmentId" = a.id) AS occ
  FROM assessments a JOIN projects p ON p.id = a."projectId"
  LEFT JOIN assessment_summaries s ON s."assessmentId" = a.id
  WHERE a.status = 'COMPLETED'
    AND s."totalFindings" - (SELECT count(*) FROM finding_occurrences o WHERE o."assessmentId" = a.id) > 0
  ORDER BY a."createdAt" DESC;
`;

for (const t of targets) {
  console.log(`\n=== ${t.name} (${t.id}) summary=${t.total} occurrences=${t.occ}`);
  const logs = await sql`
    SELECT level, plugin, message FROM assessment_logs
    WHERE "assessmentId" = ${t.id}
      AND (message ILIKE '%persisted%' OR message ILIKE '%finding%' OR level <> 'info')
    ORDER BY timestamp;
  `;
  for (const l of logs) console.log(`  [${l.level}/${l.plugin ?? '-'}] ${l.message}`);
}

await sql.end();
