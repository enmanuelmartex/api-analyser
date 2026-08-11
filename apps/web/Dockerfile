# =============================================================================
# API Analyser Web — Dockerfile
# Next.js 15 with Bun
# =============================================================================

FROM oven/bun:1-alpine AS development

WORKDIR /app

# The workspace lockfile lives at the repository root, outside this build
# context, so it cannot be copied here — `bun install` resolves within the
# semver ranges in package.json instead. The previous `bun.lockb*` glob matched
# nothing (the repo uses the text `bun.lock` format) and only looked reproducible.
COPY package.json ./
RUN bun install

COPY . .

EXPOSE 3000
CMD ["bun", "run", "dev"]

# =============================================================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .

# Build args
ARG NEXT_PUBLIC_API_URL
# Quoted: the name now contains a space, and an unquoted ARG default would stop
# at it and set the value to "API".
ARG NEXT_PUBLIC_APP_NAME="API Analyser"
ARG NEXT_PUBLIC_APP_VERSION=0.1.0

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION

# Turns on `output: 'standalone'` in next.config.ts. Opt-in there because the
# symlinks it traces cannot be created on Windows without elevation.
ENV NEXT_OUTPUT=standalone

RUN bun run build

# =============================================================================

FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
