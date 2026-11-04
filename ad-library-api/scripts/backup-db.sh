#!/bin/bash
# Nightly AdSignal DB backup -> Kingston. Consistent online copy (sqlite3 .backup), integrity-checked,
# gzip'd, last N kept. Refuses to run unless the real Kingston volume is mounted (never creates a fake
# mount directory, never falls back to internal storage).
set -euo pipefail
DB="${ADSIGNAL_DB:-$HOME/Library/Application Support/MetaAdLibraryAPI/ad-library.db}"
DEST="${ADSIGNAL_BACKUP_DIR:-/Volumes/KingstonData/Backups/AdSignal}"
KEEP="${ADSIGNAL_BACKUP_KEEP:-7}"
KINGSTON_UUID="EF149E38-03CE-45DD-8754-8EA9CEEAE65C"

actual="$(diskutil info /Volumes/KingstonData 2>/dev/null | awk -F': *' '/Volume UUID/{print $2}')"
if [ "$actual" != "$KINGSTON_UUID" ]; then
  echo "$(date '+%F %T') Kingston not mounted or wrong volume (got '${actual:-none}'); backup skipped" >&2
  exit 3
fi
[ -f "$DB" ] || { echo "$(date '+%F %T') database not found: $DB" >&2; exit 2; }

mkdir -p "$DEST"
stamp="$(date +%Y%m%d-%H%M%S)"
tmp="$DEST/.ad-library-$stamp.db"
trap 'rm -f "$tmp" "$tmp-shm" "$tmp-wal" "$DEST/.ad-library-$stamp.db.gz.partial"' EXIT

sqlite3 "$DB" ".backup '$tmp'"
if [ "$(sqlite3 "$tmp" 'pragma integrity_check;')" != "ok" ]; then
  echo "$(date '+%F %T') integrity_check failed; backup discarded" >&2
  exit 4
fi
rows="$(sqlite3 "$tmp" 'select count(*) from ad_registry;' 2>/dev/null || echo '?')"
gzip -c "$tmp" > "$DEST/.ad-library-$stamp.db.gz.partial"
mv "$DEST/.ad-library-$stamp.db.gz.partial" "$DEST/ad-library-$stamp.db.gz"
# retention: keep the newest $KEEP
ls -1t "$DEST"/ad-library-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
echo "$(date '+%F %T') ok ad-library-$stamp.db.gz registry_rows=$rows size=$(du -h "$DEST/ad-library-$stamp.db.gz" | cut -f1) kept=$(ls -1 "$DEST"/ad-library-*.db.gz | wc -l | tr -d ' ')"
