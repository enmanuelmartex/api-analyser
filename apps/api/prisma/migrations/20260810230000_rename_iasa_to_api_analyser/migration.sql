-- The v1.0 rename, as far as it reaches into the database.
--
-- `plugins.author` is the only column whose stored values carried the old name.
-- Every built-in plugin writes `appBrand.pluginAuthor` explicitly on registration,
-- so the column DEFAULT is only reached by a row inserted without one — but a
-- default that still said "IASA Core Team" would be a live source of the old name
-- for anyone writing a plugin by hand against the table.
--
-- Two statements, deliberately: changing the DEFAULT does not touch rows already
-- written with the old literal, and leaving those would mean the Security Checks
-- screen kept attributing built-in checks to a product that no longer exists.
ALTER TABLE "plugins" ALTER COLUMN "author" SET DEFAULT 'API Analyser Core Team';

UPDATE "plugins" SET "author" = 'API Analyser Core Team' WHERE "author" = 'IASA Core Team';
