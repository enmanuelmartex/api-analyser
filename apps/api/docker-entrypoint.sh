#!/bin/sh
set -e

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


echo "🚀 Starting API Analyser API..."
exec "$@"
