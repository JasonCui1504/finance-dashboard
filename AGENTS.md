# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Local-only finance dashboard

This app runs only on the owner's Mac (launchd agents on `127.0.0.1:3100`, data in `.data/finance.db`) and is never deployed. See `README.md`, including its "Backups" and "Restoring a backup" sections for questions about backing up or restoring the data. Never commit `.data/` or `.env*`.

After any code change, re-run `scripts/local/install.sh` to rebuild and restart it. Remind the user of this at the end of every such change.
