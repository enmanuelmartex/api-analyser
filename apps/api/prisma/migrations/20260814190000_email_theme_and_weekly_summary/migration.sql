-- Two columns, both needed by the transactional email pipeline.
--
-- ── users.theme ─────────────────────────────────────────────────────────────
--
-- The light/dark preference, previously held only in the browser's
-- localStorage by `next-themes`. That was the right home for it while the only
-- consumer was the browser itself. It stopped being enough when emails gained
-- light and dark variants: they are rendered server-side, in a Vercel function
-- that cannot read a browser's storage, so the preference has to be somewhere
-- the API can query at send time.
--
-- Nullable with no default, exactly like the display preferences added in
-- 20260814120000: NULL means "never chosen" and resolves to the product
-- default. Every existing row therefore keeps behaving exactly as it does
-- today, and no backfill is needed or wanted — writing a value nobody chose
-- would be inventing a preference.
--
-- Values are 'system' | 'light' | 'dark', validated at the API boundary
-- (`auth/display-preferences.ts`) rather than by a database enum, so that
-- adding an option later is not a migration. See the note on the sibling
-- columns for why this project stores presentation keys as text.
ALTER TABLE "users" ADD COLUMN "theme" TEXT;

-- ── notification_preferences.emailWeeklySummary ─────────────────────────────
--
-- The switch for the weekly digest. DEFAULT true so existing rows opt in
-- alongside the other email switches, which are all default-true — but note
-- that this changes nothing on its own: every per-event switch is subordinate
-- to `emailEnabled`, which defaults to FALSE and stays false until an operator
-- turns email on. An install that has never configured mail receives nothing
-- new as a result of this migration.
ALTER TABLE "notification_preferences"
  ADD COLUMN "emailWeeklySummary" BOOLEAN NOT NULL DEFAULT true;
