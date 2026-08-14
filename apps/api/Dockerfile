# =============================================================================
# API Analyser API — Dockerfile
# Multi-stage build with Bun
# =============================================================================

# Development stage
FROM oven/bun:1-alpine AS development

WORKDIR /app

# Install system deps for Prisma
RUN apk add --no-cache openssl

# The workspace lockfile lives at the repository root, outside this build
# context, so it cannot be copied here — `bun install` resolves within the
# semver ranges in package.json instead. The previous `bun.lockb*` glob matched
# nothing (the repo uses the text `bun.lock` format) and only looked reproducible.
COPY package.json ./
# Copy schema BEFORE bun install so @prisma/client postinstall can generate
# with the correct schema and populate Bun's internal package cache correctly
COPY prisma ./prisma
RUN bun install

COPY . .

# Pre-generate Prisma client (regenerated at runtime via entrypoint)
RUN bunx prisma generate

COPY docker-entrypoint-secrets.sh /usr/local/bin/docker-entrypoint-secrets.sh
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-secrets.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "dev"]

# =============================================================================

# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
COPY prisma ./prisma
RUN bun install

COPY . .
RUN bunx prisma generate
RUN bun run build

# =============================================================================

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl dumb-init su-exec

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

COPY docker-entrypoint-secrets.sh /usr/local/bin/docker-entrypoint-secrets.sh
COPY docker-entrypoint.prod.sh /usr/local/bin/docker-entrypoint.prod.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-secrets.sh /usr/local/bin/docker-entrypoint.prod.sh

# Reports and generated-secrets directories are named volumes at runtime.
RUN mkdir -p /app/reports /app/.secrets && chown -R nestjs:nodejs /app/reports /app/.secrets

# Deliberately no `USER nestjs` here. The entrypoint below needs to run as
# root: an operator switching this same api_secrets volume back and forth
# between `docker-compose.dev.yml` (whose stage has no USER, so it writes as
# root) and this stage otherwise leaves generated.env owned by a UID this
# container can't read, and the container never boots again. Root can always
# read it and fix ownership; the entrypoint's last act is to drop to nestjs
# via su-exec for the actual server process, so the running Node process is
# still unprivileged.
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/v1/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.prod.sh"]
CMD ["dumb-init", "--", "node", "dist/main.js"]
