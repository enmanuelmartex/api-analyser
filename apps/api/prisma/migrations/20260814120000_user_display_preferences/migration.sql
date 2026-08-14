-- User display preferences.
--
-- All nullable with no default: NULL means "not chosen", which the web app
-- resolves to the product default (and, for `timeZone`, to the browser's own
-- zone). Every existing row therefore keeps rendering exactly as it does today.
ALTER TABLE "users" ADD COLUMN "avatarColor" TEXT;
ALTER TABLE "users" ADD COLUMN "timeZone" TEXT;
ALTER TABLE "users" ADD COLUMN "dateFormat" TEXT;
ALTER TABLE "users" ADD COLUMN "timeFormat" TEXT;
