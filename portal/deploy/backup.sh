#!/usr/bin/env bash
# SafeWorks backup: the database and the photo files, into /var/backups/safeworks (kept 7 days).
#   sudo bash portal/deploy/backup.sh
# Settings: BACKUP_DIR (default /var/backups/safeworks), BACKUP_KEEP_DAYS (default 7).
# Copy the newest pair of files off the server now and then (e.g. scp) so a lost server does not mean lost data.
set -euo pipefail

PORTAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${BACKUP_DIR:-/var/backups/safeworks}"
KEEP="${BACKUP_KEEP_DAYS:-7}"
stamp="$(date -u +%Y%m%d-%H%M)"

mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$PORTAL"

docker compose exec -T db pg_dump -U safeworks -d safeworks --format=custom > "$DEST/db-$stamp.dump.part"
mv "$DEST/db-$stamp.dump.part" "$DEST/db-$stamp.dump"

docker compose exec -T app tar -C /data/storage -czf - . > "$DEST/photos-$stamp.tar.gz.part"
mv "$DEST/photos-$stamp.tar.gz.part" "$DEST/photos-$stamp.tar.gz"

find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'photos-*.tar.gz' \) -mtime +"$KEEP" -delete
find "$DEST" -maxdepth 1 -name '*.part' -mmin +60 -delete

echo "$(date -u +%FT%TZ) backup ok: $DEST/db-$stamp.dump ($(du -h "$DEST/db-$stamp.dump" | cut -f1)), photos-$stamp.tar.gz ($(du -h "$DEST/photos-$stamp.tar.gz" | cut -f1))"
