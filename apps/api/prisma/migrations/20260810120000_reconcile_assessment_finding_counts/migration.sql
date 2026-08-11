-- FindingOccurrence is the canonical record of what one assessment detected.
-- Older scanner versions wrote AssessmentSummary from raw plugin output before
-- occurrence identity normalisation, so duplicate routes such as `/admin` and
-- `/admin/` could make the summary one larger than the report body.
WITH severity_counts AS (
  SELECT
    a.id AS "assessmentId",
    COUNT(o.id)::INTEGER AS total,
    (COUNT(o.id) FILTER (WHERE o."severitySnapshot" = 'CRITICAL'))::INTEGER AS critical,
    (COUNT(o.id) FILTER (WHERE o."severitySnapshot" = 'HIGH'))::INTEGER AS high,
    (COUNT(o.id) FILTER (WHERE o."severitySnapshot" = 'MEDIUM'))::INTEGER AS medium,
    (COUNT(o.id) FILTER (WHERE o."severitySnapshot" = 'LOW'))::INTEGER AS low,
    (COUNT(o.id) FILTER (WHERE o."severitySnapshot" = 'INFO'))::INTEGER AS info
  FROM assessments a
  LEFT JOIN finding_occurrences o ON o."assessmentId" = a.id
  WHERE a.status = 'COMPLETED'
  GROUP BY a.id
),
category_counts AS (
  SELECT
    grouped."assessmentId",
    jsonb_object_agg(grouped."owaspSnapshot", grouped.total) AS coverage
  FROM (
    SELECT
      o."assessmentId",
      o."owaspSnapshot",
      COUNT(*)::INTEGER AS total
    FROM finding_occurrences o
    JOIN assessments a ON a.id = o."assessmentId"
    WHERE a.status = 'COMPLETED' AND o."owaspSnapshot" IS NOT NULL
    GROUP BY o."assessmentId", o."owaspSnapshot"
  ) grouped
  GROUP BY grouped."assessmentId"
)
UPDATE assessment_summaries s
SET
  "totalFindings" = counts.total,
  "criticalCount" = counts.critical,
  "highCount" = counts.high,
  "mediumCount" = counts.medium,
  "lowCount" = counts.low,
  "infoCount" = counts.info,
  "riskLevel" = CASE
    WHEN counts.critical > 0 THEN 'CRITICAL'
    WHEN counts.high > 0 OR counts.medium > 3 THEN 'HIGH'
    WHEN counts.medium > 0 OR counts.low > 5 THEN 'MEDIUM'
    ELSE 'LOW'
  END,
  "owaspCoverage" = COALESCE(categories.coverage, '{}'::jsonb),
  "updatedAt" = CURRENT_TIMESTAMP
FROM severity_counts counts
LEFT JOIN category_counts categories ON categories."assessmentId" = counts."assessmentId"
WHERE s."assessmentId" = counts."assessmentId";
