#!/bin/sh
set -e

# =============================================================================
# Secrets
# =============================================================================
#
# `validateEnv` refuses to boot on a weak or placeholder secret — deliberately,
# because a scanner that stores target credentials must not be encrypted with a
# key published in a repository. That left a hole in the one path this project
# advertises: `git clone && docker compose up` had no `.env`, compose supplied
# placeholder defaults, and the API aborted on the first boot with a validation
# error that looked like a bug rather than a configuration choice.
#
# So the secrets are generated here, once, and persisted on a named volume:
# every install gets its own, nothing weak ships in the image or the compose
# file, and the operator does not have to run `openssl` before they can see the
# product. Setting any of these in the environment (or in `.env`) wins — an
# operator with a secret manager keeps using it and this block does nothing.
#
# The volume matters: regenerating on each boot would rotate the key that
# encrypts stored target credentials, and every previously saved credential
# would fail to decrypt.

SECRETS_DIR=/app/.secrets
SECRETS_FILE="$SECRETS_DIR/generated.env"

mkdir -p "$SECRETS_DIR"
[ -f "$SECRETS_FILE" ] && . "$SECRETS_FILE"

generated=""

# 64 hex characters — the exact contract in env.validation.ts.
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  generated="$generated ENCRYPTION_KEY"
fi
if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  generated="$generated JWT_SECRET"
fi
if [ -z "${REFRESH_TOKEN_SECRET:-}" ]; then
  REFRESH_TOKEN_SECRET=$(openssl rand -hex 32)
  generated="$generated REFRESH_TOKEN_SECRET"
fi
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  BETTER_AUTH_SECRET=$(openssl rand -hex 32)
  generated="$generated BETTER_AUTH_SECRET"
fi

cat > "$SECRETS_FILE" <<EOF
ENCRYPTION_KEY=$ENCRYPTION_KEY
JWT_SECRET=$JWT_SECRET
REFRESH_TOKEN_SECRET=$REFRESH_TOKEN_SECRET
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
EOF
chmod 600 "$SECRETS_FILE"

export ENCRYPTION_KEY JWT_SECRET REFRESH_TOKEN_SECRET BETTER_AUTH_SECRET

if [ -n "$generated" ]; then
  echo "🔐 Generated and stored secrets on the api_secrets volume:$generated"
fi

# =============================================================================
# Database
# =============================================================================

echo "🔧 Generating Prisma client..."
bunx prisma generate --schema=/app/prisma/schema.prisma

# Bun stores @prisma/client in an internal directory whose .prisma/client
# subdirectory is NOT updated by prisma generate (it only writes to the
# top-level node_modules/.prisma/client). TypeScript resolves @prisma/client
# through Bun's symlink and ends up at the stale types. Fix: copy the freshly
# generated client into every Bun-internal @prisma/client location.
echo "🔗 Syncing generated Prisma client into Bun package store..."
for dir in /app/node_modules/.bun/@prisma+client*/; do
  if [ -d "${dir}node_modules" ]; then
    rm -rf "${dir}node_modules/.prisma"
    mkdir -p "${dir}node_modules/.prisma"
    cp -r /app/node_modules/.prisma/client "${dir}node_modules/.prisma/"
  fi
done

echo "🗄️  Pushing schema to database..."
bunx prisma db push --schema=/app/prisma/schema.prisma --accept-data-loss

echo "🧹 Clearing TypeScript incremental build cache..."
rm -f /app/dist/tsconfig.tsbuildinfo

# The first administrator is created by AdminBootstrapService when the API
# starts against an empty user table — see apps/api/src/modules/auth.

echo "🚀 Starting API Analyser API..."
exec "$@"
