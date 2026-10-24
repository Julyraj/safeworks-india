#!/bin/sh
# Container start: optional first-time/idempotent seed, then the server (which applies migrations).
#   SEED_ON_START=true  → master lists, company, 5 pilot sites and the first admin (only what is missing)
#   SEED_DEMO=true      → also sample users and observations (test servers only)
set -e
if [ "$SEED_ON_START" = "true" ]; then
  if [ "$SEED_DEMO" = "true" ]; then
    npx tsx scripts/seed.ts --demo
  else
    npx tsx scripts/seed.ts
  fi
fi
exec node dist/index.js
