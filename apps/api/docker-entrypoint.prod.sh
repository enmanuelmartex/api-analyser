#!/bin/sh
# Production entrypoint.
#
# The production image previously had no entrypoint at all — it went straight
# to `node dist/main.js`. That works only against a database that already has
# every migration applied and secrets already present in the environment;
# against a fresh `postgres_data` volume the API crashed on the first query
# because the schema didn't exist yet, and against a fresh `api_secrets`
# volume `validateEnv` refused to boot at all. This mirrors what the dev
# entrypoint already does — generate/load secrets, prepare the database — but
# with the production-appropriate database step: `prisma migrate deploy`
# applies the committed migration files exactly as recorded, and never
# generates or reconciles a schema like `db push` does. `db push
# --accept-data-loss` is a dev convenience for a throwaway database; running it
# against a real deployment's data is the kind of thing this script exists to
# rule out by construction.
#
# Runs as root (see the Dockerfile note by EXPOSE) so it can always read the
# api_secrets volume regardless of which UID last wrote to it, then drops to
# the unprivileged `nestjs` user for the process that actually serves traffic.
set -e

. /usr/local/bin/docker-entrypoint-secrets.sh

# Reasserts ownership on every boot, not just at image build time: a fresh
# `api_secrets`/`api_reports` volume is empty and inherits the image's
# ownership on first mount, but a volume last written by a *different* stage
# (docker-compose.dev.yml's `development` target runs as root, this stage
# does not) would otherwise stay root-owned forever and leave `nestjs` unable
# to write to it.
chown -R nestjs:nodejs /app/.secrets /app/reports

echo "🗄️  Applying database migrations..."
npx --yes prisma migrate deploy --schema=/app/prisma/schema.prisma

# The first administrator is created by AdminBootstrapService when the API
# starts against an empty user table — see apps/api/src/modules/auth.

echo "🚀 Starting API Analyser API (production)..."
exec su-exec nestjs "$@"
