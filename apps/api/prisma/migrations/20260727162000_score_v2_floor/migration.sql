-- score-v2 reserves NULL for unavailable assessments and uses 1 as the
-- minimum score for assessments that were successfully scored.
UPDATE "assessment_summaries"
SET
  "securityScore" = 1,
  "scoreVersion" = 'score-v2',
  "scoreExplanation" = jsonb_set(
    jsonb_set(
      COALESCE("scoreExplanation", '{}'::jsonb),
      '{securityScore}',
      '1'::jsonb,
      true
    ),
    '{scoreVersion}',
    to_jsonb('score-v2'::text),
    true
  )
WHERE "securityScore" = 0;
