#!/bin/sh
# Container start: optional seeding (SEED_ON_START / SEED_DEMO), then the API server.
set -e
cd "$(dirname "$0")/.."
if [ "$SEED_ON_START" = "true" ]; then
  if [ "$SEED_DEMO" = "true" ]; then python scripts/seed.py --demo; else python scripts/seed.py; fi
fi
exec python -m safeworks
