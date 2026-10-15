// One-off: copy the production Turso database into a local SQLite file.
//
//   1. Put FINANCE_DATABASE_URL and FINANCE_DATABASE_AUTH_TOKEN in .env.turso
//      (gitignored by .env*), e.g. via `vercel env pull .env.turso`.
//   2. node scripts/local/pull-from-turso.mjs
//
// Writes .data/finance-from-turso.db (never touches .data/finance.db) and
// prints a row count per table so the copy can be checked.
import { createClient } from "@libsql/client";
import { existsSync, readFileSync, rmSync } from "fs";

const OUT = ".data/finance-from-turso.db";

const env = Object.fromEntries(
  readFileSync(".env.turso", "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")])
);
const url = env.FINANCE_DATABASE_URL;
const authToken = env.FINANCE_DATABASE_AUTH_TOKEN;
if (!url?.startsWith("libsql://") || !authToken || authToken.includes("SENSITIVE")) {
  console.error(
    "Set FINANCE_DATABASE_URL (libsql://…) and FINANCE_DATABASE_AUTH_TOKEN in .env.turso.\n" +
      "Vercel won't export them (it writes [SENSITIVE]); copy them from app.turso.tech."
  );
  process.exit(1);
}

const remote = createClient({ url, authToken });
if (existsSync(OUT)) rmSync(OUT);
const local = createClient({ url: `file:${OUT}` });

const schema = await remote.execute(
  `SELECT type, name, sql FROM sqlite_master
   WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
   ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`
);
const tables = schema.rows.filter((r) => r.type === "table").map((r) => r.name);

for (const r of schema.rows.filter((r) => r.type === "table")) await local.execute(r.sql);

for (const table of [...tables, "sqlite_sequence"]) {
  const rows = await remote.execute(`SELECT * FROM "${table}"`).catch(() => null);
  if (!rows) continue;
  const cols = rows.columns.map((c) => `"${c}"`).join(", ");
  const marks = rows.columns.map(() => "?").join(", ");
  await local.batch(
    rows.rows.map((row) => ({
      sql: `INSERT INTO "${table}" (${cols}) VALUES (${marks})`,
      args: rows.columns.map((c) => row[c]),
    })),
    "write"
  );
  console.log(`${table.padEnd(20)} ${rows.rows.length} rows`);
}

for (const r of schema.rows.filter((r) => r.type !== "table")) await local.execute(r.sql);

console.log(`\nWrote ${OUT}`);
