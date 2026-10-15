#!/bin/zsh
# Daily price refresh against the local dashboard server (same code path the
# Vercel cron used). Run by launchd; safe to run by hand.
cd "$(dirname "$0")/../.." || exit 1
SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)
curl -fsS --max-time 320 -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:3100/api/finance/refresh
echo

# Dated same-disk backup of the database, keeping the newest 30.
BACKUPS="$HOME/finance-backups"
mkdir -p "$BACKUPS"
sqlite3 .data/finance.db ".backup '$BACKUPS/finance-$(date +%F).db'"
ls -1t "$BACKUPS"/finance-*.db | tail -n +31 | while read -r old; do rm -f "$old"; done
