# Personal Financial Dashboard — Setup

Private, single-user dashboard at `/dashboard`. Aggregates brokerage, bank,
CD, and income data into once-daily snapshots. The UI only ever reads stored
snapshots — no live API calls on page load.

## Local-only (current setup)

This repo is local-only and is not deployed anywhere. It was split out of
`photography-site-next` on 2026-10-15 (earlier history lives in that repo).
It runs only on your Mac, against `.data/finance.db`:

- `scripts/local/install.sh` builds the app and installs launchd agents:
  the server (`next start` on `127.0.0.1:3100`, started at login), a daily
  17:00 price refresh (`scripts/local/refresh.sh`), and the assistant's model
  server (see "Assistant" below). `uninstall.sh` removes them.
- Open `http://127.0.0.1:3100/dashboard` in Safari → File → Add to Dock for a
  standalone app window.
- `npm run dev` serves a dev copy on `127.0.0.1:3101`, so it doesn't clash
  with the installed server on 3100.
- `.env.local` needs `FINANCE_PASSWORD_HASH`, `FINANCE_SESSION_SECRET`,
  `CRON_SECRET` and `FINNHUB_API_KEY` (or `ALPHAVANTAGE_API_KEY`). The only
  outbound traffic is ticker symbols sent to the price API.
- After code changes, re-run `install.sh` to rebuild and restart.

### Backups

`.data/finance.db` is the only copy of the data. After each 17:00 refresh,
`refresh.sh` saves a dated copy to `~/finance-backups/finance-YYYY-MM-DD.db`
(same disk, outside iCloud) and keeps the newest 30. Manual backup any time:

```bash
mkdir -p ~/finance-backups && sqlite3 .data/finance.db ".backup '$HOME/finance-backups/finance-$(date +%F).db'"
```

### Restoring a backup

Run from the project root, picking the date to restore:

```bash
launchctl bootout gui/$UID/com.finance.dashboard.server
cp ~/finance-backups/finance-2026-10-10.db .data/finance.db
scripts/local/install.sh
```

The first line stops the dashboard server so it isn't writing to the file;
`install.sh` rebuilds and starts it again. To keep the current data just in
case, copy `.data/finance.db` somewhere first.

### Assistant ("Ask about your finances")

A chat panel on `/dashboard` answers questions with a local Llama model
(`llama3.1:8b`). Nothing leaves the Mac:

- **Own model server.** `install.sh` adds a third launchd agent,
  `com.finance.dashboard.llm`: the official standalone Ollama build in
  `~/.finance-ollama/bin` (doesn't update itself) serving on `127.0.0.1:11435`, with `OLLAMA_NO_CLOUD=1` (no Ollama cloud
  models or web search) and its own model directory `~/.finance-ollama/models`.
  It's separate from Ollama.app, which the dashboard never talks to. Log:
  `~/Library/Logs/finance-llm.log`.
- **No tools.** `lib/finance/assistant.ts` builds a read-only text summary
  with SQL (net worth, accounts, holdings, CDs, income, spending, budgets,
  bills, the newest 300 transactions) and sends it with your question.
  The model can't query, write or fetch anything, so text planted in an
  imported statement can at worst change the wording of a reply. Categories
  hidden on the dashboard are left out of the summary too.
- **Plain-text replies, strict CSP.** Replies are never rendered as markdown or
  HTML, and `next.config.ts` sets a Content-Security-Policy that only lets the
  page talk to its own origin.
- **Nothing saved.** The conversation lives in the browser tab only; closing
  the panel or the tab forgets it.

One-time setup (Homebrew has no prebuilt Ollama for macOS 14, so use the
official release): download `ollama-darwin.tgz` and `sha256sum.txt` from
[github.com/ollama/ollama/releases](https://github.com/ollama/ollama/releases),
then

```bash
shasum -a 256 -c <(grep ollama-darwin.tgz sha256sum.txt)
mkdir -p ~/.finance-ollama/bin && tar -xzf ollama-darwin.tgz -C ~/.finance-ollama/bin
scripts/local/install.sh
scripts/local/llm-pull.sh
```

To update Ollama later, extract a newer release over `~/.finance-ollama/bin`
the same way and re-run `install.sh`.

`llm-pull.sh` downloads the model (~4.9 GB). After that the model server never
needs the network, so block it: macOS's built-in firewall only filters
*incoming* connections, so use an outbound firewall such as
[LuLu](https://objective-see.org/products/lulu.html) and add a **Block** rule
for `~/.finance-ollama/bin/ollama` (the path stays the same across updates). To check, run
`nettop -m tcp -p ollama` while chatting; you should only see `127.0.0.1`.

The model is an 8B model: good at describing patterns, unreliable at maths, so
the summary carries precomputed totals and the prompt tells it to quote them.

`scripts/local/pull-from-turso.mjs` was the one-off copy from the old Turso
database. The sections below describe the previous hosted setup.

## Architecture

- **Pages**: `/dashboard` (overview), `/dashboard/manage` (manual CRUD +
  refresh), `/dashboard/login`.
- **API**: `app/api/finance/*` — everything except login requires the session
  cookie. `GET /api/finance/refresh` is the cron entry point (Bearer
  `CRON_SECRET`).
- **Database**: libSQL. Local dev uses a SQLite file at `.data/finance.db`
  (gitignored, auto-created). Production must use a hosted libSQL database
  (e.g. [Turso](https://turso.tech), free tier) because Vercel's filesystem is
  ephemeral. Schema is created automatically on first use.
- **Daily job**: Vercel Cron (`vercel.json`, 22:30 UTC — after US market
  close) hits `/api/finance/refresh`, which fetches stock prices, then writes
  an immutable `daily_snapshots` row. Snapshots double as the
  net-worth-over-time history. (All account balances are entered manually and
  can be edited any time under Manage.)

> Why not Sanity? The site's Sanity dataset is publicly readable by anyone
> with the project ID — fine for photos, not for account balances.

## Environment variables

```bash
# --- Auth (required) ---
# scrypt hash of your dashboard password ("salt:hash" hex). Generate with:
#   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password'
FINANCE_PASSWORD_HASH=
# Random string for signing session cookies:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
FINANCE_SESSION_SECRET=

# --- 2FA (strongly recommended before entering real account data) ---
# Base32 TOTP secret. Generate:
#   node -e "const b=require('crypto').randomBytes(20);const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let s='',bits=0,v=0;for(const x of b){v=(v<<8)|x;bits+=8;while(bits>=5){s+=A[(v>>>(bits-5))&31];bits-=5}}console.log(s)"
# Add to your authenticator app manually (account: jascui.com dashboard).
# Leave unset to disable 2FA.
FINANCE_TOTP_SECRET=

# --- Database (production) ---
# Local dev needs neither (defaults to file:.data/finance.db).
FINANCE_DATABASE_URL=          # e.g. libsql://finance-<org>.turso.io
FINANCE_DATABASE_AUTH_TOKEN=

# --- Stock prices (one of these; Alpha Vantage preferred per spec) ---
ALPHAVANTAGE_API_KEY=          # free tier ~25 req/day — fine for daily refresh
FINNHUB_API_KEY=               # alternative, 60 req/min (used if AV unset)

# --- Cron protection (required in production) ---
# Vercel sends this automatically as "Authorization: Bearer <CRON_SECRET>"
# once the env var is set in the project.
CRON_SECRET=
```

## Bring-up order

1. **Local dev**: set `FINANCE_PASSWORD_HASH` + `FINANCE_SESSION_SECRET` in
   `.env.local`, run `npm run dev`, sign in at `/dashboard/login`, then
   "Seed demo data" on `/dashboard/manage` to see the UI with fake data.
2. **Manual entry**: add real CDs, holdings, income under Manage. "Run
   refresh now" writes a real snapshot (uses cost basis until a price key is
   set).
3. **Prices**: set `ALPHAVANTAGE_API_KEY`, refresh again, confirm holdings
   show live prices. Note: Alpha Vantage free tier paces at ~5 req/min; with
   more than ~5 unique tickers the refresh takes 12.5s per extra ticker (the
   route allows up to 300s). Many tickers → prefer Finnhub.
4. **Production DB**: create a Turso database (`turso db create finance`),
   set `FINANCE_DATABASE_URL` + `FINANCE_DATABASE_AUTH_TOKEN` in Vercel.
5. **Deploy**: push, set all env vars in Vercel, set `CRON_SECRET`, confirm
   the cron shows up in the Vercel project (from `vercel.json`).
6. **Go live with real data** only after the checklist below.

## Security checklist before entering real account data

- [ ] `FINANCE_PASSWORD_HASH` is a hash (never the plaintext password)
- [ ] `FINANCE_TOTP_SECRET` set (2FA on)
- [ ] All secrets live in Vercel env vars / `.env.local` (gitignored) — none in the repo
- [ ] HTTPS enforced (Vercel default; session cookie is `Secure` in production)
- [ ] `/dashboard` and every `/api/finance/*` route return 401/redirect in an
      incognito window
- [ ] `CRON_SECRET` set (refresh route rejects unauthenticated GETs)
- [ ] `/dashboard` is `noindex` and disallowed in robots.txt

## Account types

Accounts are entered manually (name, institution, type, balance). Four types:
`bank`, `brokerage`, `cd`, and `retirement` (401(k)/IRA). Balances are edited
under Manage → Accounts and update dashboard totals immediately. Set an
optional savings APY on a bank account to include its interest growth in the
projection.

## Projection ("Model") feature

The dashboard's "Net worth projection" card projects to a chosen future date
using only contractual/known figures:

- **CDs**: full maturity value (principal grown at APY, open → maturity) if
  the CD matures on/before the target date; otherwise accrued value at target.
- **Bank accounts**: flat at current balance, unless the account has a savings
  APY set (Manage → Accounts), in which case it compounds at that APY.
- **Retirement**: carried flat — market-linked growth is not modeled.
- **Recurring income** (weekly/biweekly/monthly): expected deposits between
  now and the target date are summed and added.
- **Stocks/brokerage**: excluded entirely.

## Spending tracker

A separate cash-flow view (not part of net worth). Register your credit cards
under Manage → Spending, then get spending in either of two ways:

- **Import a statement (recommended).** Download your statement as CSV from the
  card issuer and upload it under Manage → Spending. Parsing happens **in your
  browser**; the CSV never needs to leave your machine as a file — only the
  cleaned transactions are POSTed. Column detection is flexible (Date /
  Description / Amount, or a separate Debit column); for single-Amount formats
  the charge sign is auto-detected with a toggle to flip it. Payments and
  refunds (credits) are skipped. Each transaction is auto-categorized from the
  merchant name (rules in `lib/finance/categories.ts`); a preview step lets you
  correct any category before importing.
- **Manual monthly total.** Under "Enter a monthly total by hand" you can log a
  whole-month amount per card (uncategorized). Used only for card+months with no
  imported transactions — imported transactions always take precedence, so the
  two never double-count.

**Categories & budgets.** Transactions carry a category from the canonical set
(Groceries, Dining, Transportation, Travel, Shopping, Utilities, Subscriptions,
Entertainment, Health, Fees, Other). Set an optional monthly limit per category
under Manage → Spending; the dashboard's Spending card then shows this month's
spend by category with budget progress bars (green under, red over).

The Spending card also shows the current month's total, a per-card breakdown, a
month-over-month delta (lower spend shown green), and a bar chart of total spend
by month.

Spending is deliberately kept out of the net-worth number — a monthly charge is
a cash flow, not a balance-sheet liability. Tables: `credit_cards`,
`card_payments` (manual monthly totals), `transactions` (imported, categorized),
and `budgets` (per-category monthly limits).

## Bank-balance reminder

Bank balances are entered manually (Manage → Accounts), so the dashboard shows
a reminder banner at the top when it's been **more than 7 days** since any bank
balance was last updated. It links straight to Manage and **clears itself** the
moment you save a bank balance (it reads the most recent `balance_updated_at`
across bank accounts). Income streams are separate — they don't change bank
balances; they only feed the projection.

## Show/hide dashboard categories

Manage → Settings → "Dashboard categories" lets you uncheck any net-worth
category (Brokerage, Bank, CDs, Retirement) to hide it from the dashboard —
e.g. hide Retirement if you don't track it here. Net worth, the allocation
donut, the over-time chart, and the projection all **recompute from the
visible categories only**, so the headline number always equals the sum of the
tiles shown. The preference is stored in the `settings` table
(`hidden_categories`) and applied server-side.

## Emergency-fund runway & spending insights

The dashboard's "Cash flow & insights" card shows an **emergency-fund runway**
(bank cash ÷ average monthly spend = months of expenses covered) plus quick
insights: average monthly spend, this month vs. that average, your highest
month, and the top category this month. Average spend uses complete prior
months (the current partial month is excluded so it isn't skewed low).

## Transaction search & filter

Manage → Spending → "Recent transactions" has a search box (matches the
description/merchant) plus category and card filters, with a running total for
the filtered set — useful once you've imported a few months.

## CD ladder

The dashboard's "CD ladder" card lays your CDs on a Today → furthest-maturity
timeline, showing each CD's principal → maturity value, when it matures (days
out or "matured"), and the total that will be available at maturity — handy for
planning reinvestment.

## CSV export / backup

Manage → bottom of the page has "Export CSV" links for net-worth history,
accounts, holdings, CDs, income, and transactions (`GET /api/finance/export?type=…`,
session-gated). Useful for backups, spreadsheets, and taxes.

## Data model

`accounts` (bank/brokerage/cd/retirement, entered manually),
`holdings` (ticker/shares/cost basis), `cds`, `income_streams`,
`daily_snapshots` (one row per day: totals + allocation JSON),
`snapshot_holdings` (per-holding value per day), `latest_prices` (last quote
per ticker, the fallback when a fetch fails), and the spending tables
`credit_cards`, `card_payments` (manual monthly totals), `transactions`
(imported, categorized), `budgets` (per-category monthly limits).

CD current value is approximated as `principal × (1 + APY)^(years since
open)`, frozen at maturity.
