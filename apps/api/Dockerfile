# =============================================================================
# API Analyser API — Dockerfile
# Multi-stage build with Bun
# =============================================================================

# Development stage
FROM oven/bun:1-alpine AS development

WORKDIR /app

# Install system deps for Prisma
RUN apk add --no-cache openssl

COPY package.json bun.lockb* ./
# Copy schema BEFORE bun install so @prisma/client postinstall can generate
# with the correct schema and populate Bun's internal package cache correctly
COPY prisma ./prisma
RUN bun install

COPY . .

# Pre-generate Prisma client (regenerated at runtime via entrypoint)
RUN bunx prisma generate

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "dev"]

# =============================================================================

# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lockb* ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

COPY . .
RUN bunx prisma generate
RUN bun run build

# =============================================================================

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl dumb-init

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Reports directory
RUN mkdir -p /app/reports && chown nestjs:nodejs /app/reports

USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
