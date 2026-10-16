#!/usr/bin/env node
// Import brokerage positions (shares + cost basis) from a JSON file into
// .data/finance.db. Run from anywhere; it works against this checkout's data.
//
//   node scripts/local/import-positions.mjs positions.json           # preview only
//   node scripts/local/import-positions.mjs positions.json --apply   # back up, import, refresh prices
//
// The file lists accounts, each with its positions:
//
//   { "as_of": "2026-10-16",
//     "accounts": [
//       { "name": "Fidelity Roth IRA", "type": "retirement", "institution": "Fidelity",
//         "positions": [
//           { "ticker": "AAPL", "shares": 1, "cost_basis": 321.14, "price": 342.00 },
//           { "ticker": "CASH", "shares": 722.07 } ] } ] }
//
// An optional top-level "warnings": ["..."] list is pinned to the top of the
// dashboard (each with a "Remove warning" button); ones already added, or
// already removed, are skipped.
//
// cost_basis is the position's total cost (null when unknown); price is the
// statement price, kept as the manual price only for tickers the price feed
// can't quote. CASH is uninvested cash: shares are dollars.
//
// Each listed account is created, or matched by name, and its positions are
// replaced, so re-running with a newer file syncs rather than duplicates.
// Loose holdings (not in any account) whose broker names one of the file's
// institutions are removed too, since the imported accounts now hold them.
// Nothing else is touched.

import { createClient } from "@libsql/client";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_PATH = join(ROOT, ".data/finance.db");
const SERVER = "http://127.0.0.1:3100";
const CASH = "CASH"; // lib/finance/prices.ts CASH_TICKER
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

const usd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ---------- read and check the file ----------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
if (!file) fail("Usage: node scripts/local/import-positions.mjs <positions.json> [--apply]");
if (!existsSync(file)) fail(`No such file: ${file}`);
if (!existsSync(DB_PATH)) fail(`No database at ${DB_PATH} — has the dashboard been run yet?`);

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  fail(`Couldn't read ${file} as JSON: ${e.message}`);
}
if (!Array.isArray(data.accounts) || data.accounts.length === 0) fail("The file lists no accounts.");

const warnings = data.warnings ?? [];
if (!Array.isArray(warnings) || warnings.some((w) => typeof w !== "string" || !w.trim())) {
  fail('"warnings" must be a list of non-empty strings.');
}

const seenNames = new Set();
for (const a of data.accounts) {
  if (typeof a.name !== "string" || !a.name.trim()) fail("An account has no name.");
  if (seenNames.has(a.name.toLowerCase())) fail(`Account listed twice: ${a.name}`);
  seenNames.add(a.name.toLowerCase());
  if (!["brokerage", "retirement"].includes(a.type)) {
    fail(`${a.name}: type must be "brokerage" or "retirement"`);
  }
  if (typeof a.institution !== "string" || !a.institution.trim()) fail(`${a.name}: no institution`);
  if (!Array.isArray(a.positions)) fail(`${a.name}: no positions list`);
  for (const p of a.positions) {
    p.ticker = String(p.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(p.ticker)) fail(`${a.name}: invalid ticker "${p.ticker}"`);
    if (!(Number(p.shares) > 0)) fail(`${a.name} ${p.ticker}: shares must be > 0`);
    if (p.cost_basis != null && !(Number(p.cost_basis) >= 0)) fail(`${a.name} ${p.ticker}: bad cost_basis`);
    if (p.ticker === CASH) p.price = 1;
    if (!(Number(p.price) > 0)) fail(`${a.name} ${p.ticker}: price must be > 0`);
  }
}

// ---------- work out what changes ----------

const db = createClient({ url: `file:${DB_PATH}` });
const accounts = (await db.execute("SELECT id, name, type, institution, last_balance FROM accounts")).rows;
const holdings = (await db.execute("SELECT id, account_id, ticker, shares, broker FROM holdings")).rows;

const lower = (s) => String(s ?? "").trim().toLowerCase();
const institutions = [...new Set(data.accounts.map((a) => lower(a.institution)))];
const plan = data.accounts.map((a) => ({
  ...a,
  existing: accounts.find((x) => lower(x.name) === lower(a.name)) ?? null,
}));
const matchedIds = new Set(plan.filter((p) => p.existing).map((p) => Number(p.existing.id)));

const replaced = holdings.filter((h) => h.account_id != null && matchedIds.has(Number(h.account_id)));
const loose = holdings.filter(
  (h) => h.account_id == null && institutions.some((i) => lower(h.broker).includes(i))
);
// Other accounts at the same brokerages may be the same money entered
// earlier as a manual balance — flag them rather than guess.
const lookalikes = accounts.filter(
  (x) =>
    !matchedIds.has(Number(x.id)) &&
    institutions.some((i) => lower(x.institution).includes(i) || lower(x.name).includes(i))
);

console.log(`\nImport from ${file}${data.as_of ? ` (positions as of ${data.as_of})` : ""}\n`);
let grandTotal = 0;
for (const a of plan) {
  const value = a.positions.reduce((s, p) => s + p.shares * p.price, 0);
  const cost = a.positions.reduce((s, p) => s + (p.cost_basis ?? 0), 0);
  grandTotal += value;
  const verb = a.existing ? "update existing account" : "create account";
  console.log(`  ${a.name}  [${a.type}, ${a.institution}] — ${verb}`);
  console.log(
    `    ${a.positions.length} positions, worth ≈ ${usd(value)} at statement prices, cost basis ${usd(cost)}`
  );
  for (const p of a.positions) {
    const what =
      p.ticker === CASH
        ? `${usd(p.shares)} cash`
        : `${p.shares} sh @ ${usd(p.price)}  cost ${p.cost_basis == null ? "unknown" : usd(p.cost_basis)}`;
    console.log(`      ${p.ticker.padEnd(6)} ${what}`);
  }
}
console.log(`\n  Total ≈ ${usd(grandTotal)}`);

if (replaced.length || loose.length) {
  console.log(`\n  Removed (replaced by the positions above):`);
  for (const h of [...replaced, ...loose]) {
    const where =
      h.account_id != null
        ? accounts.find((x) => Number(x.id) === Number(h.account_id))?.name
        : `loose, broker "${h.broker}"`;
    console.log(`      ${String(h.ticker).padEnd(6)} ${h.shares} sh  (${where})`);
  }
}
if (lookalikes.length) {
  console.log(`\n  ⚠ Not touched, but check these aren't the same money (it would count twice):`);
  for (const x of lookalikes) {
    const bal = x.last_balance == null ? "no balance" : `balance ${usd(Number(x.last_balance))}`;
    console.log(`      "${x.name}" [${x.type}, ${x.institution || "no institution"}], ${bal}`);
  }
  console.log(`    If one is, delete it under Manage → Accounts after importing.`);
}

if (warnings.length) {
  console.log(`\n  Dashboard warnings to pin:`);
  for (const w of warnings) console.log(`      ⚠ ${w}`);
}

if (!apply) {
  console.log(`\nPreview only — nothing changed. Run again with --apply to import.\n`);
  process.exit(0);
}

// ---------- apply ----------

// The running server must know CASH is reserved, or the refresh would price
// it as the NASDAQ stock of that name.
const build = join(ROOT, ".next/BUILD_ID");
if (!existsSync(build) || statSync(build).mtimeMs < statSync(join(ROOT, "lib/finance/prices.ts")).mtimeMs) {
  fail("The dashboard build is older than this code. Run scripts/local/install.sh first, then re-run this.");
}

const backupDir = join(homedir(), "finance-backups");
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
let backup = join(backupDir, `finance-before-import-${stamp}.db`);
for (let n = 2; existsSync(backup); n++) {
  backup = join(backupDir, `finance-before-import-${stamp}-${n}.db`);
}
await db.execute({ sql: "VACUUM INTO ?", args: [backup] });
console.log(`\nBacked up the database to ${backup}`);

const tx = await db.transaction("write");
const importedAccountIds = [];
try {
  for (const a of plan) {
    let id;
    if (a.existing) {
      id = Number(a.existing.id);
      await tx.execute({
        sql: "UPDATE accounts SET type = ?, institution = ? WHERE id = ?",
        args: [a.type, a.institution.trim(), id],
      });
      await tx.execute({ sql: "DELETE FROM holdings WHERE account_id = ?", args: [id] });
    } else {
      const rs = await tx.execute({
        sql: "INSERT INTO accounts (name, type, institution) VALUES (?, ?, ?) RETURNING id",
        args: [a.name.trim(), a.type, a.institution.trim()],
      });
      id = Number(rs.rows[0].id);
    }
    importedAccountIds.push(id);
    for (const p of a.positions) {
      await tx.execute({
        sql: `INSERT INTO holdings (account_id, ticker, shares, cost_basis, purchase_date, manual_price, broker)
              VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        args: [id, p.ticker, Number(p.shares), p.cost_basis ?? null, Number(p.price), a.institution.trim()],
      });
    }
  }
  for (const h of loose) {
    await tx.execute({ sql: "DELETE FROM holdings WHERE id = ?", args: [h.id] });
  }
  // Same table as lib/finance/db.ts, which may not have run since install.
  await tx.execute(`CREATE TABLE IF NOT EXISTS dashboard_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed_at TEXT
  )`);
  for (const w of warnings) {
    await tx.execute({
      sql: "INSERT OR IGNORE INTO dashboard_warnings (text) VALUES (?)",
      args: [w.trim()],
    });
  }
  await tx.commit();
} catch (e) {
  await tx.rollback();
  fail(`Import failed and was rolled back, nothing changed: ${e.message}`);
} finally {
  tx.close();
}
console.log(`Imported ${plan.reduce((s, a) => s + a.positions.length, 0)} positions into ${plan.length} accounts.`);

// Refresh prices through the running server, the same call as refresh.sh.
console.log("Refreshing prices (can take a minute)…");
let refreshed = null;
try {
  const env = existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8") : "";
  const secret = env.match(/^CRON_SECRET=(.*)$/m)?.[1]?.trim();
  if (!secret) throw new Error("no CRON_SECRET in .env.local");
  const res = await fetch(`${SERVER}/api/finance/refresh`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(320_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  refreshed = await res.json();
} catch (e) {
  console.log(
    `\n⚠ Couldn't refresh prices (${e.message}). The import is saved and valued at statement` +
      ` prices; open Manage and press Refresh once the dashboard is running.\n`
  );
  process.exit(0);
}

// Tickers the feed quoted now use live prices, so drop the statement price;
// the rest keep it as their manual price.
const quoted = new Set(
  (await db.execute("SELECT ticker FROM latest_prices")).rows.map((r) => String(r.ticker))
);
const marks = importedAccountIds.map(() => "?").join(",");
const imported = (
  await db.execute({
    sql: `SELECT id, ticker FROM holdings WHERE account_id IN (${marks})`,
    args: importedAccountIds,
  })
).rows;
const kept = new Set();
for (const h of imported) {
  const t = String(h.ticker);
  if (t === CASH) continue;
  if (quoted.has(t)) {
    await db.execute({ sql: "UPDATE holdings SET manual_price = NULL WHERE id = ?", args: [h.id] });
  } else kept.add(t);
}

console.log(`\n✓ Done. Net worth is now ${usd(refreshed.totalNetWorth)}.`);
if (kept.size) {
  console.log(
    `  No live quote for ${[...kept].sort().join(", ")} — valued at the statement price` +
      ` (set as its manual price; edit under Manage).`
  );
}
console.log(`  To undo, restore ${backup} (README → "Restoring a backup").\n`);
