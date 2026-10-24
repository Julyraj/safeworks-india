#!/usr/bin/env bash
# Restore SafeWorks from a backup made by backup.sh – also the way to move to a new server:
# run install.sh on the new server (without --demo), copy the two backup files over, then:
#   sudo bash portal/deploy/restore.sh /path/db-YYYYMMDD-HHMM.dump [/path/photos-YYYYMMDD-HHMM.tar.gz]
# This REPLACES everything in the SafeWorks database on this server.
set -euo pipefail

PORTAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${1:-}"
PHOTOS="${2:-}"
[ -f "$DUMP" ] || { echo "Usage: $0 db-XXXX.dump [photos-XXXX.tar.gz]" >&2; exit 1; }
[ -z "$PHOTOS" ] || [ -f "$PHOTOS" ] || { echo "Photo backup not found: $PHOTOS" >&2; exit 1; }

if [ "${RESTORE_YES:-}" != "1" ]; then
  read -r -p "This replaces ALL SafeWorks data on this server with the backup. Type YES to continue: " answer
  [ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }
fi

cd "$PORTAL"
echo "Stopping the app…"
docker compose stop app
echo "Restoring the database…"
docker compose exec -T db pg_restore -U safeworks -d safeworks --clean --if-exists --no-owner --exit-on-error < "$DUMP"
if [ -n "$PHOTOS" ]; then
  echo "Restoring photos…"
  docker compose run --rm -T --no-deps app sh -c 'tar -C /data/storage -xzf -' < "$PHOTOS"
fi
echo "Starting the app…"
docker compose start app
echo "Done. Sign in with the logins from the backed-up server."
