#!/bin/sh
# Sourced by docker-entrypoint.sh (dev) and docker-entrypoint.prod.sh (production).
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

# Runtime-provided values (.env / compose / secret manager) must win over any
# value persisted on the volume from a previous boot.
ENV_ENCRYPTION_KEY=${ENCRYPTION_KEY-}
ENV_JWT_SECRET=${JWT_SECRET-}
ENV_REFRESH_TOKEN_SECRET=${REFRESH_TOKEN_SECRET-}
ENV_BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET-}

mkdir -p "$SECRETS_DIR"
[ -f "$SECRETS_FILE" ] && . "$SECRETS_FILE"

[ -n "$ENV_ENCRYPTION_KEY" ] && ENCRYPTION_KEY="$ENV_ENCRYPTION_KEY"
[ -n "$ENV_JWT_SECRET" ] && JWT_SECRET="$ENV_JWT_SECRET"
[ -n "$ENV_REFRESH_TOKEN_SECRET" ] && REFRESH_TOKEN_SECRET="$ENV_REFRESH_TOKEN_SECRET"
[ -n "$ENV_BETTER_AUTH_SECRET" ] && BETTER_AUTH_SECRET="$ENV_BETTER_AUTH_SECRET"

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
