"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtUSD } from "../components/format";
import CategorySelect, { useTaxonomy } from "./CategorySelect";
import { summarizeTax } from "../../../lib/finance/tax";
import { CASH_TICKER } from "../../../lib/finance/prices";
import StatementImport from "./StatementImport";
import HoldingsImport from "./HoldingsImport";

type Account = {
  id: number;
  name: string;
  type: string;
  institution: string;
  last_balance: number | null;
  apy: number | null;
};
type Holding = {
  id: number;
  account_id: number | null;
  ticker: string;
  shares: number;
  cost_basis: number | null;
  purchase_date: string | null;
  manual_price: number | null;
  broker: string | null;
};
type Cd = {
  id: number;
  bank_name: string;
  principal: number;
  apy: number;
  open_date: string;
  maturity_date: string;
  term_months: number | null;
};
type Income = {
  id: number;
  source_name: string;
  amount: number;
  frequency: string;
  date_received: string | null;
  tax_withheld: number | null;
};
type CreditCard = { id: number; name: string; issuer: string };
type Bill = {
  id: number;
  name: string;
  amount: number;
  start_month: string;
  category_id: number | null;
};
type BillPayment = { id: number; bill_id: number; month: string; amount: number };
type CardPayment = {
  id: number;
  card_id: number;
  month: string;
  amount: number;
  note: string | null;
};
type Transaction = {
  id: number;
  card_id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
  category_id: number | null;
  category_source: string;
  is_card_credit: boolean;
  benefit_id: number | null;
  hidden: boolean;
};
type Budget = {
  id: number;
  group_id: number | null;
  category_id: number | null;
  monthly_limit: number;
};
type MerchantRule = {
  id: number;
  match_key: string;
  category: string;
  category_id: number | null;
};
type CardBenefit = {
  id: number;
  card_id: number;
  name: string;
  amount: number;
  period: "annual" | "monthly";
};

const TABS = [
  "Accounts",
  "Holdings",
  "Retirement",
  "CDs",
  "Income",
  "Spending",
  "Categories",
  "Settings",
] as const;

const NET_WORTH_CATEGORIES: { key: string; label: string }[] = [
  { key: "brokerage", label: "Brokerage" },
  { key: "bank", label: "Bank" },
  { key: "cds", label: "CDs" },
  { key: "retirement", label: "Retirement" },
];
const ACCOUNT_TYPES = ["bank", "brokerage", "retirement"] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const inputCls =
  "rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-prose outline-none transition-colors focus:border-accent";
const btnCls =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50";
const ghostBtnCls =
  "rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-prose";
const linkBtnCls = "text-xs text-faint transition-colors hover:text-subtle";
const delBtnCls = "text-xs text-faint transition-colors hover:text-red-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-faint">
      {label}
      {children}
    </label>
  );
}

export default function ManageClient({ seedEnabled }: { seedEnabled: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Accounts");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const note = useCallback((kind: "ok" | "err", text: string) => {
    setBanner({ kind, text });
  }, []);

  // Mutations recompute the daily snapshot server-side; refresh the router so
  // the dashboard page shows new totals immediately on navigation.
  const touch = useCallback(() => router.refresh(), [router]);

  async function runRefresh() {
    setBusy(true);
    setBanner(null);
    try {
      const r = await api<{ totalNetWorth: number; warnings: string[] }>(
        "/api/finance/refresh",
        { method: "POST" }
      );
      note(
        "ok",
        `Snapshot written — net worth ${fmtUSD(r.totalNetWorth)}.` +
          (r.warnings.length ? ` Warnings: ${r.warnings.join(" | ")}` : "")
      );
      touch();
    } catch (e) {
      note("err", e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  async function runResetHistory() {
    if (
      !confirm(
        "Reset net-worth history?\n\nThis clears the entire net-worth chart (daily snapshots) and starts fresh with a single point for today. Your accounts, holdings, CDs, cards, and income are NOT affected."
      )
    )
      return;
    setBusy(true);
    setBanner(null);
    try {
      const r = await api<{ totalNetWorth: number }>(
        "/api/finance/reset-history",
        { method: "POST" }
      );
      note(
        "ok",
        `History reset — chart now starts today at ${fmtUSD(r.totalNetWorth)}.`
      );
      touch();
    } catch (e) {
      note("err", e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function runSeed() {
    if (!confirm("Replace ALL finance data with demo data?")) return;
    setBusy(true);
    try {
      await api("/api/finance/seed", { method: "POST" });
      note("ok", "Demo data seeded.");
      touch();
    } catch (e) {
      note("err", e instanceof Error ? e.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/finance/auth", { method: "DELETE" });
    router.replace("/dashboard/login");
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="fin-rise flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-medium">Manage</h1>
        <Link href="/dashboard" className="text-sm text-faint hover:text-subtle">
          ← Dashboard
        </Link>
        <div className="ml-auto flex gap-2">
          <button onClick={runRefresh} disabled={busy} className={btnCls}>
            {busy ? "Working…" : "Run refresh now"}
          </button>
          <button onClick={runResetHistory} disabled={busy} className={ghostBtnCls}>
            Reset history
          </button>
          {seedEnabled && (
            <button onClick={runSeed} disabled={busy} className={ghostBtnCls}>
              Seed demo data
            </button>
          )}
          <button onClick={logout} className={ghostBtnCls}>
            Sign out
          </button>
        </div>
      </header>

      {banner && (
        <p
          className={`fin-rise rounded-md border px-3 py-2 text-sm ${
            banner.kind === "ok"
              ? "border-accent-dim text-subtle"
              : "border-red-900 text-red-400"
          }`}
        >
          {banner.text}
        </p>
      )}

      <nav className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === t
                ? "border-b-2 border-accent text-prose"
                : "text-faint hover:text-subtle"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Accounts" && <AccountsTab note={note} touch={touch} />}
      {tab === "Holdings" && <HoldingsTab note={note} touch={touch} />}
      {tab === "Retirement" && <RetirementTab note={note} touch={touch} />}
      {tab === "CDs" && <CdsTab note={note} touch={touch} />}
      {tab === "Income" && <IncomeTab note={note} touch={touch} />}
      {tab === "Spending" && <SpendingTab note={note} touch={touch} />}
      {tab === "Categories" && <CategoriesTab note={note} touch={touch} />}
      {tab === "Settings" && <SettingsTab note={note} touch={touch} />}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 text-xs text-faint">
        <span>Export CSV:</span>
        {[
          { type: "snapshots", label: "Net worth history" },
          { type: "accounts", label: "Accounts" },
          { type: "holdings", label: "Holdings" },
          { type: "cds", label: "CDs" },
          { type: "income", label: "Income" },
          { type: "transactions", label: "Transactions" },
        ].map((x) => (
          <a
            key={x.type}
            href={`/api/finance/export?type=${x.type}`}
            className="text-subtle underline decoration-line underline-offset-2 transition-colors hover:text-prose hover:decoration-accent"
          >
            {x.label}
          </a>
        ))}
      </div>
    </div>
  );
}

type Note = (kind: "ok" | "err", text: string) => void;
type TabProps = { note: Note; touch: () => void };

function useList<T>(path: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    api<T[]>(path)
      .then((d) => {
        setItems(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [path]);
  useEffect(reload, [reload]);
  return { items, loaded, reload };
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2 border-t border-line py-2.5 text-sm transition-colors hover:bg-lift/30">
      {children}
    </li>
  );
}

// ---------- Accounts ----------

const emptyAccountForm = {
  name: "",
  type: "bank" as string,
  institution: "",
  last_balance: "",
  apy: "",
};

function AccountsTab({ note, touch }: TabProps) {
  const { items, loaded, reload } = useList<Account>("/api/finance/accounts");
  const [form, setForm] = useState(emptyAccountForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState(emptyAccountForm);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/accounts", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          last_balance: form.last_balance === "" ? null : Number(form.last_balance),
          apy: form.apy === "" ? null : Number(form.apy),
        }),
      });
      setForm(emptyAccountForm);
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  function startEdit(a: Account) {
    setEditingId(a.id);
    setEdit({
      name: a.name,
      type: a.type,
      institution: a.institution,
      last_balance: a.last_balance == null ? "" : String(a.last_balance),
      apy: a.apy == null ? "" : String(a.apy),
    });
  }

  async function saveEdit(id: number) {
    try {
      await api(`/api/finance/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: edit.name,
          type: edit.type,
          institution: edit.institution,
          last_balance: edit.last_balance === "" ? null : Number(edit.last_balance),
          apy: edit.apy === "" ? null : Number(edit.apy),
        }),
      });
      setEditingId(null);
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(a: Account) {
    if (!confirm(`Delete "${a.name}"${a.type === "brokerage" ? " (and its holdings)" : ""}?`)) return;
    await api(`/api/finance/accounts/${a.id}`, { method: "DELETE" });
    reload();
    touch();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Name">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Type">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className={inputCls}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution">
          <input
            value={form.institution}
            onChange={(e) => setForm({ ...form, institution: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Balance">
          <input
            type="number"
            step="0.01"
            value={form.last_balance}
            onChange={(e) => setForm({ ...form, last_balance: e.target.value })}
            className={`${inputCls} w-28`}
          />
        </Field>
        <Field label="APY % (savings, optional)">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.apy}
            onChange={(e) => setForm({ ...form, apy: e.target.value })}
            className={`${inputCls} w-24`}
          />
        </Field>
        <button className={btnCls}>Add account</button>
      </form>

      <ul>
        {items.map((a) =>
          editingId === a.id ? (
            <li key={a.id} className="border-t border-line bg-lift/30 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Name">
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Type">
                  <select
                    value={edit.type}
                    onChange={(e) => setEdit({ ...edit, type: e.target.value })}
                    className={inputCls}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Institution">
                  <input
                    value={edit.institution}
                    onChange={(e) => setEdit({ ...edit, institution: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Balance">
                  <input
                    type="number"
                    step="0.01"
                    value={edit.last_balance}
                    onChange={(e) => setEdit({ ...edit, last_balance: e.target.value })}
                    className={`${inputCls} w-28`}
                  />
                </Field>
                <Field label="APY %">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={edit.apy}
                    onChange={(e) => setEdit({ ...edit, apy: e.target.value })}
                    className={`${inputCls} w-24`}
                  />
                </Field>
                <button onClick={() => saveEdit(a.id)} className={btnCls} type="button">
                  Save
                </button>
                <button onClick={() => setEditingId(null)} className={ghostBtnCls} type="button">
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <Row key={a.id}>
              <span className="text-prose">{a.name}</span>
              <span className="text-xs text-faint">
                {a.type} · {a.institution || "—"}
                {a.apy != null ? ` · ${a.apy}% APY` : ""}
              </span>
              <span className="ml-auto tabular-nums text-subtle">
                {a.last_balance != null ? fmtUSD(a.last_balance) : "—"}
              </span>
              <button onClick={() => startEdit(a)} className={linkBtnCls}>
                edit
              </button>
              <button onClick={() => remove(a)} className={delBtnCls}>
                delete
              </button>
            </Row>
          )
        )}
        {loaded && items.length === 0 && (
          <p className="py-4 text-sm text-faint">No accounts yet.</p>
        )}
      </ul>
      <p className="text-xs text-faint">
        Set an APY on savings accounts to include interest growth in projections.
        Adding, editing, or deleting an account updates dashboard totals
        immediately.
      </p>
    </div>
  );
}

// ---------- Holdings ----------

type HoldingEdit = Record<
  "ticker" | "shares" | "cost_basis" | "manual_price" | "broker" | "account_id",
  string
>;

function holdingEditFrom(h: Holding): HoldingEdit {
  return {
    ticker: h.ticker,
    shares: String(h.shares),
    cost_basis: h.cost_basis == null ? "" : String(h.cost_basis),
    manual_price: h.manual_price == null ? "" : String(h.manual_price),
    broker: h.broker ?? "",
    account_id: h.account_id == null ? "" : String(h.account_id),
  };
}

/** "3 shares · cost $107.40" — cash shows as a dollar amount instead. */
function holdingSummary(h: Holding): string {
  if (h.ticker === CASH_TICKER) return `${fmtUSD(h.shares)} cash`;
  return (
    `${h.shares} shares` +
    (h.cost_basis != null ? ` · cost ${fmtUSD(h.cost_basis)}` : "") +
    (h.manual_price != null ? ` · manual ${fmtUSD(h.manual_price)}` : "")
  );
}

/**
 * Inline editor for one holding, shared by the Holdings and Retirement tabs:
 * every field, including which account it sits in. A partial sale is an edit
 * (fewer shares, lower cost basis); selling everything is "remove".
 */
function HoldingEditRow({
  holding,
  accounts,
  onDone,
  onError,
}: {
  holding: Holding;
  accounts: Account[];
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [edit, setEdit] = useState(() => holdingEditFrom(holding));
  const isCash = edit.ticker === CASH_TICKER;

  async function save() {
    try {
      await api(`/api/finance/holdings/${holding.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ticker: edit.ticker,
          shares: edit.shares === "" ? null : Number(edit.shares),
          cost_basis: edit.cost_basis === "" ? null : Number(edit.cost_basis),
          manual_price: edit.manual_price === "" ? null : Number(edit.manual_price),
          broker: edit.broker.trim() || null,
          account_id: edit.account_id === "" ? null : Number(edit.account_id),
        }),
      });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <li className="border-t border-line bg-lift/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ticker">
          <input
            required
            value={edit.ticker}
            onChange={(e) => setEdit({ ...edit, ticker: e.target.value.toUpperCase() })}
            className={`${inputCls} w-24`}
          />
        </Field>
        <Field label={isCash ? "Amount ($)" : "Shares"}>
          <input
            type="number"
            step="any"
            min="0"
            value={edit.shares}
            onChange={(e) => setEdit({ ...edit, shares: e.target.value })}
            className={`${inputCls} w-28`}
          />
        </Field>
        {!isCash && (
          <>
            <Field label="Cost basis (total $)">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="optional"
                value={edit.cost_basis}
                onChange={(e) => setEdit({ ...edit, cost_basis: e.target.value })}
                className={`${inputCls} w-32`}
              />
            </Field>
            <Field label="Manual price">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="if no live quote"
                value={edit.manual_price}
                onChange={(e) => setEdit({ ...edit, manual_price: e.target.value })}
                className={`${inputCls} w-32`}
              />
            </Field>
          </>
        )}
        <Field label="Account">
          <select
            value={edit.account_id}
            onChange={(e) => setEdit({ ...edit, account_id: e.target.value })}
            className={inputCls}
          >
            <option value="">None (loose holding)</option>
            {accounts
              .filter((a) => a.type === "brokerage" || a.type === "retirement")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Broker">
          <input
            placeholder="e.g. Schwab"
            value={edit.broker}
            onChange={(e) => setEdit({ ...edit, broker: e.target.value })}
            className={`${inputCls} w-28`}
          />
        </Field>
        <button onClick={save} className={btnCls} type="button">
          Save
        </button>
        <button onClick={onDone} className={ghostBtnCls} type="button">
          Cancel
        </button>
      </div>
    </li>
  );
}

function HoldingsTab({ note, touch }: TabProps) {
  const { items: allHoldings, loaded, reload } = useList<Holding>("/api/finance/holdings");
  const { items: accounts } = useList<Account>("/api/finance/accounts");
  // Retirement positions live on their own tab; showing them here too would
  // imply they are counted twice.
  const retirementIds = new Set(
    accounts.filter((a) => a.type === "retirement").map((a) => a.id)
  );
  const items = allHoldings.filter(
    (h) => h.account_id == null || !retirementIds.has(h.account_id)
  );
  const emptyForm = { ticker: "", shares: "", cost_basis: "", manual_price: "", broker: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"broker" | "ticker">("broker");
  const [brokerFilter, setBrokerFilter] = useState("");

  // Group by the account a holding sits in (e.g. "Robinhood Biotech"), else
  // by its broker label.
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const brokerOf = (h: Holding) =>
    (h.account_id != null && accountName.get(h.account_id)) || h.broker?.trim() || "No broker";
  const brokers = [...new Set(items.map(brokerOf))].sort((a, b) =>
    a === "No broker" ? 1 : b === "No broker" ? -1 : a.localeCompare(b)
  );
  const shown = items
    .filter((h) => !brokerFilter || brokerOf(h) === brokerFilter)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  // By brokerage: one group per broker (alphabetical, "No broker" last), tickers A–Z inside.
  const groups =
    sortBy === "broker"
      ? brokers
          .map((name) => ({ name, rows: shown.filter((h) => brokerOf(h) === name) }))
          .filter((g) => g.rows.length > 0)
      : [{ name: "", rows: shown }];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/holdings", {
        method: "POST",
        body: JSON.stringify({
          ticker: form.ticker,
          shares: Number(form.shares),
          cost_basis: form.cost_basis === "" ? null : Number(form.cost_basis),
          manual_price: form.manual_price === "" ? null : Number(form.manual_price),
          broker: form.broker.trim() || null,
        }),
      });
      setForm(emptyForm);
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(h: Holding) {
    if (!confirm(`Remove ${h.ticker}? Use this when you've sold all of it.`)) return;
    await api(`/api/finance/holdings/${h.id}`, { method: "DELETE" });
    reload();
    touch();
  }

  const renderHolding = (h: Holding) =>
    editingId === h.id ? (
      <HoldingEditRow
        key={h.id}
        holding={h}
        accounts={accounts}
        onDone={() => {
          setEditingId(null);
          reload();
          touch();
        }}
        onError={(msg) => note("err", msg)}
      />
    ) : (
      <Row key={h.id}>
        <span className="text-prose">{h.ticker}</span>
        <span className="text-xs text-faint">
          {holdingSummary(h)}
          {/* The group heading names the broker when grouped. */}
          {h.broker && sortBy === "ticker" ? ` · ${h.broker}` : ""}
        </span>
        <span className="ml-auto" />
        <button onClick={() => setEditingId(h.id)} className={linkBtnCls}>
          edit
        </button>
        <button onClick={() => remove(h)} className={delBtnCls}>
          remove
        </button>
      </Row>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Add a holding</h3>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Field label="Ticker">
            <input
              required
              value={form.ticker}
              onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
              className={`${inputCls} w-24`}
            />
          </Field>
          <Field label="Shares">
            <input
              required
              type="number"
              step="any"
              min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              className={`${inputCls} w-28`}
            />
          </Field>
          <Field label="Cost basis (total $)">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="optional"
              value={form.cost_basis}
              onChange={(e) => setForm({ ...form, cost_basis: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </Field>
          <Field label="Broker">
            <input
              placeholder="e.g. Schwab"
              value={form.broker}
              onChange={(e) => setForm({ ...form, broker: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </Field>
          <Field label="Manual price (if no live quote)">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="optional"
              value={form.manual_price}
              onChange={(e) => setForm({ ...form, manual_price: e.target.value })}
              className={`${inputCls} w-40`}
            />
          </Field>
          <button className={btnCls}>Add holding</button>
        </form>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-faint">
            <label className="flex items-center gap-1.5">
              Sort
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "broker" | "ticker")} className={`${inputCls} py-1 text-xs`}>
                <option value="broker">By brokerage</option>
                <option value="ticker">By ticker (A–Z)</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Show
              <select value={brokerFilter} onChange={(e) => setBrokerFilter(e.target.value)} className={`${inputCls} py-1 text-xs`}>
                <option value="">All accounts</option>
                {brokers.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <span className="ml-auto tabular-nums">
              {shown.length} of {items.length} holdings
            </span>
          </div>
        )}
        <ul>
          {groups.map((g) => (
            <li key={g.name || "all"} className="list-none">
              {g.name && (
                <p className="mt-3 flex items-baseline gap-2 border-b border-line pb-1 text-xs uppercase tracking-wide text-faint">
                  {g.name}
                  <span className="normal-case tracking-normal">
                    {g.rows.length} {g.rows.length === 1 ? "holding" : "holdings"}
                  </span>
                </p>
              )}
              <ul>{g.rows.map(renderHolding)}</ul>
            </li>
          ))}
          {loaded && items.length === 0 && (
            <p className="py-4 text-sm text-faint">No holdings yet.</p>
          )}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Import holdings (paste)</h3>
        <HoldingsImport
          onImported={(n) => {
            note("ok", `Added ${n} holdings.`);
            reload();
            touch();
          }}
          onError={(msg) => note("err", msg)}
        />
      </div>
    </div>
  );
}

// ---------- Retirement ----------

/**
 * Retirement accounts holding positions rather than a typed-in balance. A
 * position here is an ordinary holding attached to the account, priced from
 * the same live quotes as the brokerage ones; once an account has any, its
 * manual balance stops counting so the money is never added twice.
 */
function RetirementTab({ note, touch }: TabProps) {
  const { items: accounts, loaded: accountsLoaded } =
    useList<Account>("/api/finance/accounts");
  const { items: holdings, reload } = useList<Holding>("/api/finance/holdings");
  const [form, setForm] = useState({
    account_id: "",
    ticker: "",
    shares: "",
    cost_basis: "",
    manual_price: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);

  const retirement = accounts.filter((a) => a.type === "retirement");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/holdings", {
        method: "POST",
        body: JSON.stringify({
          account_id: Number(form.account_id),
          ticker: form.ticker,
          shares: Number(form.shares),
          cost_basis: form.cost_basis === "" ? null : Number(form.cost_basis),
          manual_price: form.manual_price === "" ? null : Number(form.manual_price),
        }),
      });
      setForm({ ...form, ticker: "", shares: "", cost_basis: "", manual_price: "" });
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(h: Holding) {
    if (!confirm(`Remove ${h.ticker}? Use this when you've sold all of it.`)) return;
    await api(`/api/finance/holdings/${h.id}`, { method: "DELETE" });
    reload();
    touch();
  }

  if (accountsLoaded && retirement.length === 0) {
    return (
      <p className="py-4 text-sm text-faint">
        No retirement accounts yet. Add one under Accounts with type
        &ldquo;retirement&rdquo; — a Roth IRA, traditional IRA or 401(k) — then
        add its positions here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Add a position</h3>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Field label="Account">
            <select
              required
              value={form.account_id}
              onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              className={inputCls}
            >
              <option value="">Select account</option>
              {retirement.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ticker">
            <input
              required
              value={form.ticker}
              onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
              className={`${inputCls} w-24`}
            />
          </Field>
          <Field label="Shares">
            <input
              required
              type="number"
              step="any"
              min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              className={`${inputCls} w-28`}
            />
          </Field>
          <Field label="Cost basis (total $)">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="optional"
              value={form.cost_basis}
              onChange={(e) => setForm({ ...form, cost_basis: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </Field>
          <Field label="Manual price (if no live quote)">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="optional"
              value={form.manual_price}
              onChange={(e) => setForm({ ...form, manual_price: e.target.value })}
              className={`${inputCls} w-40`}
            />
          </Field>
          <button className={btnCls}>Add position</button>
        </form>
      </div>

      {retirement.map((a) => {
        const positions = holdings.filter((h) => h.account_id === a.id);
        return (
          <div key={a.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-medium text-subtle">{a.name}</h3>
              {a.institution && (
                <span className="text-xs text-faint">{a.institution}</span>
              )}
              <span className="ml-auto text-xs text-faint">
                {positions.length > 0 ? (
                  <>
                    valued from {positions.length} position
                    {positions.length === 1 ? "" : "s"} ·{" "}
                    <span className="line-through">
                      {a.last_balance != null ? fmtUSD(a.last_balance) : "no balance"}
                    </span>{" "}
                    ignored
                  </>
                ) : (
                  <>
                    manual balance{" "}
                    {a.last_balance != null ? fmtUSD(a.last_balance) : "—"}
                  </>
                )}
              </span>
            </div>
            <ul>
              {positions.map((h) =>
                editingId === h.id ? (
                  <HoldingEditRow
                    key={h.id}
                    holding={h}
                    accounts={accounts}
                    onDone={() => {
                      setEditingId(null);
                      reload();
                      touch();
                    }}
                    onError={(msg) => note("err", msg)}
                  />
                ) : (
                  <Row key={h.id}>
                    <span className="text-prose">{h.ticker}</span>
                    <span className="text-xs text-faint">{holdingSummary(h)}</span>
                    <span className="ml-auto" />
                    <button onClick={() => setEditingId(h.id)} className={linkBtnCls}>
                      edit
                    </button>
                    <button onClick={() => remove(h)} className={delBtnCls}>
                      remove
                    </button>
                  </Row>
                )
              )}
              {positions.length === 0 && (
                <p className="py-3 text-sm text-faint">
                  No positions yet — this account still counts its manual balance.
                </p>
              )}
            </ul>
          </div>
        );
      })}

      <p className="text-xs text-faint">
        Positions are priced from the same live quotes as your brokerage
        holdings, and refresh on the nightly run. An account with positions is
        valued from them, so its manual balance is ignored rather than added —
        add its uninvested cash (e.g. SPAXX) as ticker {CASH_TICKER} with the
        dollar amount as shares.
      </p>
    </div>
  );
}

// ---------- CDs ----------

const emptyCdForm = {
  bank_name: "",
  principal: "",
  apy: "",
  open_date: "",
  maturity_date: "",
  term_months: "",
};

function cdProjectedMaturity(principal: number, apy: number, open: string, maturity: string): number {
  const years =
    (new Date(maturity + "T00:00:00Z").getTime() - new Date(open + "T00:00:00Z").getTime()) /
    (365.25 * 24 * 3600 * 1000);
  return principal * Math.pow(1 + apy / 100, Math.max(0, years));
}

function CdsTab({ note, touch }: TabProps) {
  const { items, loaded, reload } = useList<Cd>("/api/finance/cds");
  const [form, setForm] = useState(emptyCdForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState(emptyCdForm);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/cds", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          principal: Number(form.principal),
          apy: Number(form.apy),
          term_months: form.term_months === "" ? null : Number(form.term_months),
        }),
      });
      setForm(emptyCdForm);
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveEdit(id: number) {
    try {
      await api(`/api/finance/cds/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          bank_name: edit.bank_name,
          principal: Number(edit.principal),
          apy: Number(edit.apy),
          open_date: edit.open_date,
          maturity_date: edit.maturity_date,
          term_months: edit.term_months === "" ? null : Number(edit.term_months),
        }),
      });
      setEditingId(null);
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this CD?")) return;
    await api(`/api/finance/cds/${id}`, { method: "DELETE" });
    reload();
    touch();
  }

  const cdFields = (
    state: typeof emptyCdForm,
    set: (s: typeof emptyCdForm) => void
  ) => (
    <>
      <Field label="Bank">
        <input
          required
          value={state.bank_name}
          onChange={(e) => set({ ...state, bank_name: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Principal">
        <input
          required
          type="number"
          step="0.01"
          min="0"
          value={state.principal}
          onChange={(e) => set({ ...state, principal: e.target.value })}
          className={`${inputCls} w-28`}
        />
      </Field>
      <Field label="APY %">
        <input
          required
          type="number"
          step="0.01"
          min="0"
          value={state.apy}
          onChange={(e) => set({ ...state, apy: e.target.value })}
          className={`${inputCls} w-24`}
        />
      </Field>
      <Field label="Opened">
        <input
          required
          type="date"
          value={state.open_date}
          onChange={(e) => set({ ...state, open_date: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Matures">
        <input
          required
          type="date"
          value={state.maturity_date}
          onChange={(e) => set({ ...state, maturity_date: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Term (mo)">
        <input
          type="number"
          value={state.term_months}
          onChange={(e) => set({ ...state, term_months: e.target.value })}
          className={`${inputCls} w-20`}
        />
      </Field>
    </>
  );

  const preview =
    form.principal && form.apy && form.open_date && form.maturity_date
      ? cdProjectedMaturity(
          Number(form.principal),
          Number(form.apy),
          form.open_date,
          form.maturity_date
        )
      : null;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        {cdFields(form, setForm)}
        <button className={btnCls}>Add CD</button>
        {preview != null && Number.isFinite(preview) && (
          <span className="pb-1.5 text-xs text-faint">
            ≈ {fmtUSD(preview)} at maturity
          </span>
        )}
      </form>
      <ul>
        {items.map((cd) =>
          editingId === cd.id ? (
            <li key={cd.id} className="border-t border-line bg-lift/30 p-3">
              <div className="flex flex-wrap items-end gap-2">
                {cdFields(edit, setEdit)}
                <button onClick={() => saveEdit(cd.id)} className={btnCls} type="button">
                  Save
                </button>
                <button onClick={() => setEditingId(null)} className={ghostBtnCls} type="button">
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <Row key={cd.id}>
              <span className="text-prose">{cd.bank_name}</span>
              <span className="text-xs text-faint">
                {fmtUSD(cd.principal)} @ {cd.apy}% · {cd.open_date} → {cd.maturity_date}
              </span>
              <span className="ml-auto tabular-nums text-subtle">
                {fmtUSD(
                  cdProjectedMaturity(cd.principal, cd.apy, cd.open_date, cd.maturity_date)
                )}{" "}
                <span className="text-xs text-faint">at maturity</span>
              </span>
              <button
                onClick={() => {
                  setEditingId(cd.id);
                  setEdit({
                    bank_name: cd.bank_name,
                    principal: String(cd.principal),
                    apy: String(cd.apy),
                    open_date: cd.open_date,
                    maturity_date: cd.maturity_date,
                    term_months: cd.term_months == null ? "" : String(cd.term_months),
                  });
                }}
                className={linkBtnCls}
              >
                edit
              </button>
              <button onClick={() => remove(cd.id)} className={delBtnCls}>
                delete
              </button>
            </Row>
          )
        )}
        {loaded && items.length === 0 && (
          <p className="py-4 text-sm text-faint">No CDs yet.</p>
        )}
      </ul>
    </div>
  );
}

// ---------- Income ----------

function IncomeTab({ note, touch }: TabProps) {
  const { items, loaded, reload } = useList<Income>("/api/finance/income");
  const tax = summarizeTax(items);
  const [form, setForm] = useState({
    source_name: "",
    amount: "",
    tax_withheld: "",
    kind: "paycheck" as "paycheck" | "one_off" | "recurring",
    frequency: "monthly",
    date_received: "",
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/income", {
        method: "POST",
        body: JSON.stringify({
          source_name: form.source_name,
          amount: Number(form.amount),
          tax_withheld: form.tax_withheld === "" ? null : Number(form.tax_withheld),
          frequency: form.kind === "recurring" ? form.frequency : form.kind,
          date_received: form.date_received || null,
        }),
      });
      setForm({ ...form, source_name: "", amount: "", tax_withheld: "", date_received: "" });
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function setTax(id: number, value: string) {
    try {
      await api(`/api/finance/income/${id}`, {
        method: "PUT",
        body: JSON.stringify({ tax_withheld: value === "" ? null : Number(value) }),
      });
      reload();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this income entry?")) return;
    await api(`/api/finance/income/${id}`, { method: "DELETE" });
    reload();
    touch();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Field label="Source">
          <input
            required
            placeholder="e.g. Salary"
            value={form.source_name}
            onChange={(e) => setForm({ ...form, source_name: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Take-home amount">
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className={`${inputCls} w-28`}
          />
        </Field>
        <Field label="Tax withheld">
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="optional"
            title="Tax withheld for the same period. Gross is take-home + tax."
            value={form.tax_withheld}
            onChange={(e) => setForm({ ...form, tax_withheld: e.target.value })}
            className={`${inputCls} w-28`}
          />
        </Field>
        <div className="flex flex-col gap-1 text-xs text-faint">
          Type
          <div className="flex items-center gap-3 py-1.5 text-sm text-subtle">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={form.kind === "paycheck"}
                onChange={() => setForm({ ...form, kind: "paycheck" })}
              />
              Paycheck
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={form.kind === "one_off"}
                onChange={() => setForm({ ...form, kind: "one_off" })}
              />
              One-off
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={form.kind === "recurring"}
                onChange={() => setForm({ ...form, kind: "recurring" })}
              />
              Recurring
            </label>
          </div>
        </div>
        {form.kind === "recurring" && (
          <Field label="Frequency">
            <select
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              className={inputCls}
            >
              <option value="weekly">weekly</option>
              <option value="biweekly">biweekly</option>
              <option value="monthly">monthly</option>
              <option value="irregular">irregular</option>
            </select>
          </Field>
        )}
        <Field label="Date received / expected">
          <input
            type="date"
            required={form.kind === "paycheck"}
            value={form.date_received}
            onChange={(e) => setForm({ ...form, date_received: e.target.value })}
            className={inputCls}
          />
        </Field>
        <button className={btnCls}>Log income</button>
      </form>
      <ul>
        {items.map((i) => (
          <Row key={i.id}>
            <span className="text-prose">{i.source_name}</span>
            <span className="text-xs text-faint">
              {i.frequency.replace("_", "-")}
              {i.date_received ? ` · ${i.date_received}` : ""}
            </span>
            <span className="ml-auto tabular-nums text-subtle">{fmtUSD(i.amount)}</span>
            <label className="flex items-center gap-1.5 text-xs text-faint">
              tax
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="—"
                defaultValue={i.tax_withheld ?? ""}
                onBlur={(e) => {
                  const next = e.target.value === "" ? null : Number(e.target.value);
                  if (next !== i.tax_withheld) setTax(i.id, e.target.value);
                }}
                className="w-24 rounded border border-line bg-canvas px-1.5 py-1 text-xs tabular-nums text-prose outline-none focus:border-accent"
              />
            </label>
            <button onClick={() => remove(i.id)} className={delBtnCls}>
              delete
            </button>
          </Row>
        ))}
        {loaded && items.length === 0 && (
          <p className="py-4 text-sm text-faint">No income logged yet.</p>
        )}
      </ul>

      {tax.monthlyNet > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas/40 p-4">
          <h3 className="text-sm font-medium text-subtle">Tax withheld</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-faint">Gross / mo</dt>
              <dd className="tabular-nums text-prose">{fmtUSD(tax.monthlyGross)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Withheld / mo</dt>
              <dd className="tabular-nums text-prose">{fmtUSD(tax.monthlyTax)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Take-home / mo</dt>
              <dd className="tabular-nums text-prose">{fmtUSD(tax.monthlyNet)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Effective rate</dt>
              <dd className="tabular-nums text-accent">
                {tax.effectiveRate != null
                  ? `${(tax.effectiveRate * 100).toFixed(1)}%`
                  : "—"}
              </dd>
            </div>
          </dl>
          {tax.missingTax > 0 && (
            <p className="text-xs text-faint">
              {tax.missingTax} recurring {tax.missingTax === 1 ? "entry has" : "entries have"}{" "}
              no tax figure yet, so the rate understates what you actually pay.
            </p>
          )}
          {tax.oneOffCount > 0 && (
            <p className="text-xs text-faint">
              {`Plus ${tax.oneOffCount} one-off / irregular ${
                tax.oneOffCount === 1 ? "entry" : "entries"
              }: ${fmtUSD(tax.oneOffNet)} take-home, ${fmtUSD(tax.oneOffTax)} withheld`}
              {" — not in the rate above, since a lump sum can't be annualized."}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-faint">
        Amounts are take-home; gross is take-home plus the tax you record beside
        it. Log each paycheck as a Paycheck: they build the pay history, year-to-date
        totals, and tax rate in the dashboard&apos;s Income section. Recurring entries
        (weekly / biweekly / monthly) feed the net-worth projection. One-off and
        irregular entries are recorded but not projected forward.
      </p>
    </div>
  );
}

// ---------- Settings (dashboard category visibility) ----------

function SettingsTab({ note, touch }: TabProps) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ hidden_categories: string[] }>("/api/finance/settings")
      .then((d) => {
        setHidden(d.hidden_categories ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function toggle(key: string, visible: boolean) {
    const next = visible ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      await api("/api/finance/settings", {
        method: "POST",
        body: JSON.stringify({ hidden_categories: next }),
      });
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Dashboard categories</h3>
        <p className="text-xs text-faint">
          Uncheck a category to hide it from the dashboard. Net worth, the
          allocation chart, the over-time chart, and the projection all recompute
          from the categories you keep visible.
        </p>
        <ul className="flex flex-col gap-1">
          {NET_WORTH_CATEGORIES.map((c) => {
            const visible = !hidden.includes(c.key);
            return (
              <li key={c.key}>
                <label className="flex w-fit cursor-pointer items-center gap-2.5 py-1.5 text-sm text-subtle">
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={!loaded}
                    onChange={(e) => toggle(c.key, e.target.checked)}
                  />
                  {c.label}
                  {!visible && <span className="text-xs text-faint">(hidden)</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ---------- Spending (credit cards + monthly amounts) ----------

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "2026-09" -> "September 2026" */
function monthName(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Months back from `month` (inclusive), newest first. */
function recentMonths(month: string, count: number): string[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function billMonth(month: string, long = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    year: long ? "numeric" : "2-digit",
    timeZone: "UTC",
  });
}

/**
 * Bills paid outside your cards (rent, internet…), logged month by month: pick
 * a month, check or adjust each bill's amount (pre-filled with its usual
 * amount), and save. A grid shows what's been logged for recent months.
 */
function BillsSection({ note, touch }: TabProps) {
  const { items: bills, loaded, reload: reloadBills } = useList<Bill>("/api/finance/bills");
  const { items: payments, reload: reloadPayments } = useList<BillPayment>("/api/finance/bill-payments");
  const { taxonomy } = useTaxonomy();
  const [month, setMonth] = useState(currentMonth());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", amount: "" });
  const [saving, setSaving] = useState(false);

  const logged = (billId: number, m: string) => payments.find((p) => p.bill_id === billId && p.month === m);
  // What the month's box shows: your typing, else what's logged, else the usual amount.
  const valueFor = (b: Bill) => edits[`${month}|${b.id}`] ?? String(logged(b.id, month)?.amount ?? b.amount);
  const loggedCount = bills.filter((b) => logged(b.id, month)).length;
  const monthTotal = bills.reduce((s, b) => s + (Number(valueFor(b)) || 0), 0);
  // Six months ending at the latest of: this month, the one being logged, or any logged ahead.
  const newest = [currentMonth(), month, ...payments.map((p) => p.month)].sort().pop()!;
  const history = recentMonths(newest, 6);

  function refresh() {
    reloadBills();
    reloadPayments();
    touch();
  }

  async function saveMonth(e: React.FormEvent) {
    e.preventDefault();
    const entries = bills
      .map((b) => ({ bill_id: b.id, amount: valueFor(b).trim() }))
      .filter((x) => x.amount !== "")
      .map((x) => ({ ...x, amount: Number(x.amount) }));
    if (entries.some((x) => !Number.isFinite(x.amount) || x.amount < 0)) {
      note("err", "Amounts must be 0 or more");
      return;
    }
    setSaving(true);
    try {
      await api("/api/finance/bill-payments", { method: "POST", body: JSON.stringify({ month, entries }) });
      setEdits({});
      note("ok", `Logged ${entries.length} ${entries.length === 1 ? "bill" : "bills"} for ${billMonth(month, true)}`);
      refresh();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearEntry(p: BillPayment, name: string) {
    if (!confirm(`Remove ${name} for ${billMonth(p.month, true)}?`)) return;
    await api(`/api/finance/bill-payments/${p.id}`, { method: "DELETE" });
    refresh();
  }

  async function addBill(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/bills", {
        method: "POST",
        body: JSON.stringify({ name: form.name, amount: Number(form.amount) }),
      });
      setForm({ name: "", amount: "" });
      refresh();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function setBillCategory(b: Bill, category_id: number | null) {
    try {
      await api(`/api/finance/bills/${b.id}`, { method: "PUT", body: JSON.stringify({ category_id }) });
      refresh();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function setUsual(b: Bill, amount: number) {
    try {
      await api(`/api/finance/bills/${b.id}`, { method: "PUT", body: JSON.stringify({ amount }) });
      refresh();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function removeBill(b: Bill) {
    if (!confirm(`Delete "${b.name}" and every month logged for it? Past spending totals will drop.`)) return;
    await api(`/api/finance/bills/${b.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-subtle">Bills</h3>
        <p className="mt-1 text-xs text-faint">
          Costs paid outside your cards, like rent or internet. Log what each one
          actually came to every month; they count toward spending under the
          Bills category.
        </p>
      </div>

      {bills.length > 0 && (
        <form onSubmit={saveMonth} className="flex flex-col gap-2 rounded-lg border border-line bg-canvas/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-prose">Log bills for</span>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className={inputCls}
            />
            <span className="text-xs text-faint">
              {loggedCount === bills.length
                ? "✓ all logged — edit to correct"
                : `${loggedCount} of ${bills.length} logged`}
            </span>
          </div>
          <ul className="flex flex-col">
            {bills.map((b) => {
              const entry = logged(b.id, month);
              return (
                <li key={b.id} className="flex items-center gap-3 border-t border-line py-1.5 text-sm">
                  <span className="w-40 truncate text-prose">{b.name}</span>
                  <label className="flex items-center gap-1 text-xs text-faint">
                    $
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valueFor(b)}
                      onChange={(e) => setEdits({ ...edits, [`${month}|${b.id}`]: e.target.value })}
                      className={`${inputCls} w-28 tabular-nums`}
                    />
                  </label>
                  <span className={`text-xs ${entry ? "text-[#17a06b]" : "text-faint"}`}>
                    {entry ? "✓ logged" : `not logged · usually ${fmtUSD(b.amount)}`}
                  </span>
                  {entry && (
                    <button type="button" onClick={() => clearEntry(entry, b.name)} className={`${delBtnCls} ml-auto`}>
                      clear
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
            <button disabled={saving} className={btnCls}>
              {saving ? "Saving…" : `Save ${billMonth(month, true)}`}
            </button>
            <span className="text-xs tabular-nums text-faint">
              Total {fmtUSD(monthTotal)} · leave a box empty to skip that bill this month
            </span>
          </div>
        </form>
      )}

      {bills.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-xs text-faint">
                <th className="py-1 pr-3 text-left font-normal">Bill</th>
                {history.map((m) => (
                  <th key={m} className="px-2 py-1 text-right font-normal">
                    <button type="button" onClick={() => setMonth(m)} className={`hover:text-prose ${m === month ? "text-prose" : ""}`}>
                      {billMonth(m)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="py-1 pr-3 text-subtle">{b.name}</td>
                  {history.map((m) => {
                    const p = logged(b.id, m);
                    return (
                      <td key={m} className={`px-2 py-1 text-right tabular-nums ${p ? "text-prose" : "text-faint"}`}>
                        {p ? fmtUSD(p.amount, 0) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-line text-xs">
                <td className="py-1 pr-3 text-faint">Total</td>
                {history.map((m) => (
                  <td key={m} className="px-2 py-1 text-right tabular-nums text-subtle">
                    {fmtUSD(
                      payments.filter((p) => p.month === m).reduce((s, p) => s + p.amount, 0),
                      0
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-faint">Click a month to log or correct it above.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-faint">Your bills and their usual amounts (used to pre-fill each month)</p>
        <ul>
          {bills.map((b) => (
            <Row key={`${b.id}-${b.amount}`}>
              <span className="text-prose">{b.name}</span>
              <CategorySelect
                value={b.category_id}
                onChange={(category_id) => setBillCategory(b, category_id)}
                taxonomy={taxonomy}
                ariaLabel={`Category for ${b.name}`}
                className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-subtle outline-none focus:border-accent"
              />
              <label className="ml-auto flex items-center gap-1.5 text-xs text-faint">
                usually $
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={b.amount}
                  onBlur={(e) => {
                    const next = Number(e.target.value);
                    if (next > 0 && next !== b.amount) setUsual(b, next);
                  }}
                  className="w-24 rounded border border-line bg-canvas px-1.5 py-1 text-xs tabular-nums text-prose outline-none focus:border-accent"
                />
              </label>
              <button onClick={() => removeBill(b)} className={delBtnCls}>
                delete
              </button>
            </Row>
          ))}
          {loaded && bills.length === 0 && <p className="py-2 text-sm text-faint">No bills yet.</p>}
        </ul>
        <form onSubmit={addBill} className="flex flex-wrap items-end gap-2">
          <Field label="New bill">
            <input
              required
              placeholder="e.g. Electricity"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Usual amount">
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className={`${inputCls} w-28`}
            />
          </Field>
          <button className={btnCls}>Add bill</button>
        </form>
      </div>
    </div>
  );
}

function SpendingTab({ note, touch }: TabProps) {
  const { items: cards, loaded: cardsLoaded, reload: reloadCards } =
    useList<CreditCard>("/api/finance/credit-cards");
  const { items: payments, reload: reloadPayments } =
    useList<CardPayment>("/api/finance/card-payments");
  const { items: transactions, reload: reloadTx } =
    useList<Transaction>("/api/finance/transactions");
  const { items: benefits, reload: reloadBenefits } =
    useList<CardBenefit>("/api/finance/card-benefits");
  const { taxonomy } = useTaxonomy();

  const [benefitForm, setBenefitForm] = useState({
    card_id: "",
    name: "",
    amount: "",
    period: "annual",
  });
  const [cardForm, setCardForm] = useState({ name: "", issuer: "" });
  const [pay, setPay] = useState({ card_id: "", month: currentMonth(), amount: "" });
  const [showManual, setShowManual] = useState(false);
  const [txSearch, setTxSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCard, setFilterCard] = useState("");
  const [filterHidden, setFilterHidden] = useState<"exclude" | "include" | "only">("exclude");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [selectedTx, setSelectedTx] = useState<Set<number>>(new Set());
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [showWipe, setShowWipe] = useState(false);

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/credit-cards", {
        method: "POST",
        body: JSON.stringify(cardForm),
      });
      setCardForm({ name: "", issuer: "" });
      reloadCards();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function removeCard(c: CreditCard) {
    if (!confirm(`Delete "${c.name}" and all its spending (manual + imported)?`)) return;
    await api(`/api/finance/credit-cards/${c.id}`, { method: "DELETE" });
    reloadCards();
    reloadPayments();
    reloadTx();
    touch();
  }

  async function logPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/card-payments", {
        method: "POST",
        body: JSON.stringify({
          card_id: Number(pay.card_id),
          month: pay.month,
          amount: Number(pay.amount),
        }),
      });
      setPay({ ...pay, amount: "" });
      reloadPayments();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function removePayment(id: number) {
    if (!confirm("Delete this monthly entry?")) return;
    await api(`/api/finance/card-payments/${id}`, { method: "DELETE" });
    reloadPayments();
    touch();
  }

  async function setTxCategory(id: number, category_id: number | null) {
    await api(`/api/finance/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ category_id }),
    });
    reloadTx();
    touch();
  }

  async function removeTx(id: number) {
    await api(`/api/finance/transactions/${id}`, { method: "DELETE" });
    setSelectedTx((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    reloadTx();
    touch();
  }

  async function addBenefit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/finance/card-benefits", {
        method: "POST",
        body: JSON.stringify({
          card_id: Number(benefitForm.card_id),
          name: benefitForm.name,
          amount: Number(benefitForm.amount),
          period: benefitForm.period,
        }),
      });
      setBenefitForm({ card_id: benefitForm.card_id, name: "", amount: "", period: "annual" });
      reloadBenefits();
      touch();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
    }
  }

  async function removeBenefit(b: CardBenefit) {
    if (
      !window.confirm(
        `Delete the "${b.name}" benefit? Credits tagged to it stay marked but become unassigned.`
      )
    ) {
      return;
    }
    await api(`/api/finance/card-benefits/${b.id}`, { method: "DELETE" });
    reloadBenefits();
    reloadTx();
    touch();
  }

  async function setTxBenefit(id: number, benefitId: number | null) {
    await api(`/api/finance/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ benefit_id: benefitId }),
    });
    reloadTx();
    touch();
  }

  async function setTxCardCredit(id: number, isCardCredit: boolean) {
    await api(`/api/finance/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ is_card_credit: isCardCredit }),
    });
    reloadTx();
    touch();
  }

  function toggleMonthCollapsed(month: string) {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function setMonthSelected(ids: number[], selected: boolean) {
    setSelectedTx((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleTxSelected(id: number) {
    setSelectedTx((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setSelectedTxHidden(ids: number[], hidden: boolean) {
    if (ids.length === 0) return;
    try {
      const res = await api<{ updated?: number }>("/api/finance/transactions", {
        method: "PATCH",
        body: JSON.stringify({ ids, hidden }),
      });
      setSelectedTx(new Set());
      reloadTx();
      note(
        "ok",
        `${hidden ? "Hid" : "Unhid"} ${res?.updated ?? ids.length} transactions.`
      );
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Update failed");
    }
  }

  async function removeSelectedTx(ids: number[]) {
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await api<{ deleted?: number }>("/api/finance/transactions", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      setSelectedTx(new Set());
      reloadTx();
      touch();
      note("ok", `Deleted ${res?.deleted ?? ids.length} transactions.`);
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function wipeAllTx() {
    try {
      const res = await api<{ deleted?: number }>("/api/finance/transactions", {
        method: "DELETE",
        body: JSON.stringify({ all: true }),
      });
      setSelectedTx(new Set());
      setWipeConfirm("");
      setShowWipe(false);
      reloadTx();
      touch();
      note("ok", `Deleted all ${res?.deleted ?? 0} transactions.`);
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Delete failed");
    }
  }

  const cardName = (id: number) => cards.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      {/* Credit cards */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Credit cards</h3>
        <form onSubmit={addCard} className="flex flex-wrap items-end gap-2">
          <Field label="Card name">
            <input
              required
              placeholder="e.g. Chase Sapphire"
              value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Issuer (optional)">
            <input
              placeholder="Chase"
              value={cardForm.issuer}
              onChange={(e) => setCardForm({ ...cardForm, issuer: e.target.value })}
              className={inputCls}
            />
          </Field>
          <button className={btnCls}>Add card</button>
        </form>
        <ul>
          {cards.map((c) => (
            <Row key={c.id}>
              <span className="text-prose">{c.name}</span>
              {c.issuer && <span className="text-xs text-faint">{c.issuer}</span>}
              <span className="ml-auto" />
              <button onClick={() => removeCard(c)} className={delBtnCls}>
                delete
              </button>
            </Row>
          ))}
          {cardsLoaded && cards.length === 0 && (
            <p className="py-4 text-sm text-faint">
              No cards yet. Add a card, then import a statement or log a monthly
              total.
            </p>
          )}
        </ul>
      </div>

      <BillsSection note={note} touch={touch} />

      {cards.length > 0 && (
        <>
          {/* Card benefits */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-subtle">Card benefits</h3>
            <p className="text-xs text-faint">
              The credits each card gives you back. Defining them lets the
              dashboard show how much of each is still unused.
            </p>
            <form onSubmit={addBenefit} className="flex flex-wrap items-end gap-2">
              <Field label="Card">
                <select
                  required
                  value={benefitForm.card_id}
                  onChange={(e) =>
                    setBenefitForm({ ...benefitForm, card_id: e.target.value })
                  }
                  className={inputCls}
                >
                  <option value="">Select card</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Benefit">
                <input
                  required
                  placeholder="e.g. Airline fee credit"
                  value={benefitForm.name}
                  onChange={(e) =>
                    setBenefitForm({ ...benefitForm, name: e.target.value })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Amount">
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="200"
                  value={benefitForm.amount}
                  onChange={(e) =>
                    setBenefitForm({ ...benefitForm, amount: e.target.value })
                  }
                  className={`${inputCls} w-28`}
                />
              </Field>
              <Field label="Resets">
                <select
                  value={benefitForm.period}
                  onChange={(e) =>
                    setBenefitForm({ ...benefitForm, period: e.target.value })
                  }
                  className={inputCls}
                >
                  <option value="annual">per year</option>
                  <option value="monthly">per month</option>
                </select>
              </Field>
              <button className={btnCls}>Add benefit</button>
            </form>
            <ul>
              {benefits.map((b) => (
                <Row key={b.id}>
                  <span className="text-prose">{b.name}</span>
                  <span className="text-xs text-faint">
                    {cardName(b.card_id)} · {fmtUSD(b.amount)}{" "}
                    {b.period === "monthly" ? "/mo" : "/yr"}
                  </span>
                  <span className="ml-auto" />
                  <button onClick={() => removeBenefit(b)} className={delBtnCls}>
                    delete
                  </button>
                </Row>
              ))}
              {benefits.length === 0 && (
                <p className="py-3 text-sm text-faint">
                  No benefits yet — add one to start tracking what&apos;s unused.
                </p>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-subtle">Import a statement</h3>
            <StatementImport
              cards={cards}
              onImported={(n) => {
                note("ok", `Imported ${n} transactions.`);
                reloadTx();
                touch();
              }}
              onError={(msg) => note("err", msg)}
            />
          </div>

          {/* Recent transactions */}
          {(() => {
            const q = txSearch.trim().toLowerCase();
            const filtered = transactions.filter(
              (t) =>
                (q === "" || t.description.toLowerCase().includes(q)) &&
                (filterCategory === "" ||
                  (filterCategory === "none"
                    ? t.category_id == null
                    : String(t.category_id) === filterCategory)) &&
                (filterCard === "" || String(t.card_id) === filterCard) &&
                (filterHidden === "include" ||
                  (filterHidden === "only" ? t.hidden : !t.hidden))
            );
            const hiddenCount = transactions.filter((t) => t.hidden).length;
            const filterActive =
              q !== "" ||
              filterCategory !== "" ||
              filterCard !== "" ||
              filterHidden !== "exclude";
            const filteredTotal = filtered.reduce((s, t) => s + t.amount, 0);
            const selectedShown = filtered.filter((t) => selectedTx.has(t.id));
            const allShownSelected =
              filtered.length > 0 && selectedShown.length === filtered.length;

            // Rows arrive newest-first, so walking them in order keeps the
            // months in order too.
            const monthGroups: { month: string; rows: Transaction[]; total: number }[] = [];
            for (const t of filtered) {
              const month = t.date.slice(0, 7);
              const last = monthGroups[monthGroups.length - 1];
              if (last && last.month === month) last.rows.push(t);
              else monthGroups.push({ month, rows: [t], total: 0 });
            }
            for (const g of monthGroups) {
              g.total = g.rows.reduce((s, t) => s + t.amount, 0);
            }
            return (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-subtle">
                  Recent transactions{" "}
                  {transactions.length > 0 && (
                    <span className="text-xs font-normal text-faint">
                      ({filterActive ? `${filtered.length} of ${transactions.length}` : transactions.length})
                    </span>
                  )}
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-sm text-faint">
                    No imported transactions yet. Import a statement above.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="search"
                        placeholder="Search description…"
                        value={txSearch}
                        onChange={(e) => setTxSearch(e.target.value)}
                        className={`${inputCls} w-56`}
                      />
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">All categories</option>
                        <option value="none">Uncategorized</option>
                        {taxonomy.groups.map((g) => (
                          <optgroup key={g.id} label={g.name}>
                            {taxonomy.categories
                              .filter((c) => c.group_id === g.id)
                              .map((c) => (
                                <option key={c.id} value={String(c.id)}>
                                  {c.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      <select
                        value={filterCard}
                        onChange={(e) => setFilterCard(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">All cards</option>
                        {cards.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={filterHidden}
                        onChange={(e) =>
                          setFilterHidden(e.target.value as "exclude" | "include" | "only")
                        }
                        className={inputCls}
                        title="Hidden rows are left out of this list only — totals are unaffected"
                      >
                        <option value="exclude">Hide hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ""}</option>
                        <option value="include">Show hidden</option>
                        <option value="only">Only hidden</option>
                      </select>
                      {filterActive && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setTxSearch("");
                              setFilterCategory("");
                              setFilterCard("");
                              setFilterHidden("exclude");
                            }}
                            className={linkBtnCls}
                          >
                            clear filters
                          </button>
                          <span className="ml-auto text-xs text-faint tabular-nums">
                            {fmtUSD(filteredTotal)} total
                          </span>
                        </>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto rounded border border-line">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface text-left text-xs text-faint">
                          <tr>
                            <th className="p-2 font-normal">
                              <input
                                type="checkbox"
                                aria-label="Select all shown"
                                checked={allShownSelected}
                                onChange={() =>
                                  setSelectedTx(
                                    allShownSelected
                                      ? new Set()
                                      : new Set(filtered.map((t) => t.id))
                                  )
                                }
                              />
                            </th>
                            <th className="p-2 font-normal">Date</th>
                            <th className="p-2 font-normal">Card</th>
                            <th className="p-2 font-normal">Description</th>
                            <th className="p-2 text-right font-normal">Amount</th>
                            <th className="p-2 font-normal">Category</th>
                            <th
                              className="p-2 font-normal"
                              title="Card benefit credit or points redemption"
                            >
                              Credit
                            </th>
                            <th className="p-2 font-normal"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="p-4 text-center text-sm text-faint">
                                No transactions match those filters.
                              </td>
                            </tr>
                          ) : (
                            monthGroups.map((g) => {
                              const ids = g.rows.map((t) => t.id);
                              const allSelected = ids.every((id) => selectedTx.has(id));
                              const collapsed = collapsedMonths.has(g.month);
                              return (
                            <Fragment key={g.month}>
                              <tr className="border-t border-line bg-canvas/60">
                                <td className="p-2">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select all of ${monthName(g.month)}`}
                                    checked={allSelected}
                                    onChange={() => setMonthSelected(ids, !allSelected)}
                                  />
                                </td>
                                <td colSpan={7} className="p-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleMonthCollapsed(g.month)}
                                    aria-expanded={!collapsed}
                                    className="flex w-full items-center gap-2 text-left text-xs text-subtle transition-colors hover:text-prose"
                                  >
                                    <span className="text-faint">{collapsed ? "▸" : "▾"}</span>
                                    <span className="font-medium">{monthName(g.month)}</span>
                                    <span className="text-faint">
                                      {g.rows.length} row{g.rows.length === 1 ? "" : "s"}
                                    </span>
                                    <span className="ml-auto tabular-nums text-faint">
                                      {fmtUSD(g.total)}
                                    </span>
                                  </button>
                                </td>
                              </tr>
                              {!collapsed &&
                            g.rows.map((t) => (
                      <tr
                        key={t.id}
                        className={`border-t border-line ${t.hidden ? "opacity-45" : ""}`}
                      >
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${t.description}`}
                            checked={selectedTx.has(t.id)}
                            onChange={() => toggleTxSelected(t.id)}
                          />
                        </td>
                        <td className="p-2 tabular-nums text-subtle">{t.date}</td>
                        <td className="p-2 text-faint">{cardName(t.card_id)}</td>
                        <td
                          className="max-w-[240px] truncate p-2 text-subtle"
                          title={t.description}
                        >
                          {t.description}
                          {t.hidden && (
                            <span className="ml-2 text-xs text-faint">hidden</span>
                          )}
                        </td>
                        <td
                          className={`p-2 text-right tabular-nums ${
                            t.amount < 0 ? "text-green-400" : "text-prose"
                          }`}
                        >
                          {fmtUSD(t.amount)}
                        </td>
                        <td className="p-2">
                          <CategorySelect
                            value={t.category_id}
                            onChange={(id) => setTxCategory(t.id, id)}
                            taxonomy={taxonomy}
                            ariaLabel={`Category for ${t.description}`}
                            className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-prose outline-none focus:border-accent"
                          />
                        </td>
                        <td className="p-2">
                          {t.amount < 0 ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                aria-label="Card benefit credit or points redemption"
                                title="Card benefit credit or points redemption"
                                checked={t.is_card_credit}
                                onChange={() =>
                                  setTxCardCredit(t.id, !t.is_card_credit)
                                }
                              />
                              {t.is_card_credit && (
                                <select
                                  value={t.benefit_id ?? ""}
                                  onChange={(e) =>
                                    setTxBenefit(
                                      t.id,
                                      e.target.value === "" ? null : Number(e.target.value)
                                    )
                                  }
                                  className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-prose outline-none focus:border-accent"
                                >
                                  <option value="">unassigned</option>
                                  {benefits
                                    .filter((b) => b.card_id === t.card_id)
                                    .map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.name}
                                      </option>
                                    ))}
                                </select>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-faint">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          <button onClick={() => removeTx(t.id)} className={delBtnCls}>
                            delete
                          </button>
                        </td>
                      </tr>
                            ))}
                            </Fragment>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={selectedShown.length === 0}
                        onClick={() =>
                          setSelectedTxHidden(
                            selectedShown.map((t) => t.id),
                            true
                          )
                        }
                        className={`${ghostBtnCls} disabled:opacity-40`}
                      >
                        Hide selected ({selectedShown.length})
                      </button>
                      <button
                        type="button"
                        disabled={selectedShown.every((t) => !t.hidden)}
                        onClick={() =>
                          setSelectedTxHidden(
                            selectedShown.map((t) => t.id),
                            false
                          )
                        }
                        className={`${ghostBtnCls} disabled:opacity-40`}
                      >
                        Unhide selected
                      </button>
                      <button
                        type="button"
                        disabled={selectedShown.length === 0}
                        onClick={() =>
                          removeSelectedTx(selectedShown.map((t) => t.id))
                        }
                        className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-40 disabled:hover:border-line disabled:hover:text-subtle"
                      >
                        Delete selected ({selectedShown.length})
                      </button>
                      {selectedShown.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedTx(new Set())}
                          className={linkBtnCls}
                        >
                          clear selection
                        </button>
                      )}
                      <span className="ml-auto text-xs text-faint">
                        {selectedShown.length} of {filtered.length} selected
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 rounded-md border border-red-900/60 p-3">
                      <button
                        type="button"
                        onClick={() => setShowWipe((v) => !v)}
                        className="self-start text-xs text-faint transition-colors hover:text-red-400"
                      >
                        {showWipe ? "▾" : "▸"} Danger zone
                      </button>
                      {showWipe && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-subtle">
                            Delete all {transactions.length} transactions — type
                            DELETE to confirm:
                          </span>
                          <input
                            value={wipeConfirm}
                            onChange={(e) => setWipeConfirm(e.target.value)}
                            placeholder="DELETE"
                            className={`${inputCls} w-28`}
                          />
                          <button
                            type="button"
                            disabled={wipeConfirm !== "DELETE"}
                            onClick={wipeAllTx}
                            className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-400 transition-opacity hover:opacity-80 disabled:opacity-40"
                          >
                            Delete all
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Manual monthly total (fallback) */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="self-start text-sm text-faint transition-colors hover:text-subtle"
            >
              {showManual ? "▾" : "▸"} Enter a monthly total by hand (no statement)
            </button>
            {showManual && (
              <>
                <form onSubmit={logPayment} className="flex flex-wrap items-end gap-2">
                  <Field label="Card">
                    <select
                      required
                      value={pay.card_id}
                      onChange={(e) => setPay({ ...pay, card_id: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">Select card</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Month">
                    <input
                      required
                      type="month"
                      value={pay.month}
                      onChange={(e) => setPay({ ...pay, month: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Amount spent">
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={pay.amount}
                      onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                      className={`${inputCls} w-32`}
                    />
                  </Field>
                  <button className={btnCls}>Save</button>
                </form>
                <p className="text-xs text-faint">
                  A whole-month total for a card, used when you haven&apos;t imported
                  a statement for that card+month (imported transactions take
                  precedence). Uncategorized.
                </p>
                <ul>
                  {payments.map((p) => (
                    <Row key={p.id}>
                      <span className="text-prose">{cardName(p.card_id)}</span>
                      <span className="text-xs text-faint">{p.month}</span>
                      <span className="ml-auto tabular-nums text-subtle">
                        {fmtUSD(p.amount)}
                      </span>
                      <button onClick={() => removePayment(p.id)} className={delBtnCls}>
                        delete
                      </button>
                    </Row>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Categories (labels, merchant rules, budgets, re-sort) ----------

type ResortReport = {
  total_transactions: number;
  changes: number;
  categories: {
    category_id: number | null;
    name: string;
    group: string | null;
    count: number;
    total: number;
    top_merchants: { name: string; total: number; count: number }[];
  }[];
  subscriptions: { name: string; amount: number; count: number }[];
};

/**
 * Everything about how spending is labelled: rename / add / move / delete
 * groups and categories, the merchant rules you've taught, budgets, and the
 * reviewed re-sort that applies all of it to past transactions.
 */
function CategoriesTab({ note, touch }: TabProps) {
  const { taxonomy, reload: reloadTax } = useTaxonomy();
  const { items: rules, reload: reloadRules } = useList<MerchantRule>("/api/finance/merchant-rules");
  const { items: budgets, reload: reloadBudgets } = useList<Budget>("/api/finance/budgets");
  const [report, setReport] = useState<ResortReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState<Record<number, string>>({});
  const [newGroup, setNewGroup] = useState("");
  const [deleting, setDeleting] = useState<{ id: number; moveTo: number | null } | null>(null);
  const [budgetForm, setBudgetForm] = useState({ target: "", monthly_limit: "" });
  const [ruleSearch, setRuleSearch] = useState("");

  function refreshAll() {
    reloadTax();
    reloadRules();
    reloadBudgets();
    touch();
  }

  async function run(action: () => Promise<unknown>, ok?: string) {
    try {
      await action();
      if (ok) note("ok", ok);
      refreshAll();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Failed");
      refreshAll();
    }
  }

  async function preview() {
    setBusy(true);
    try {
      setReport(await api<ResortReport>("/api/finance/categories/resort"));
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyResort() {
    if (!report) return;
    if (!confirm(`Re-sort ${report.changes} transactions? Your database is backed up first.`)) return;
    setBusy(true);
    try {
      const r = await api<{ changed: number; backup: string | null }>("/api/finance/categories/resort", {
        method: "POST",
      });
      note("ok", `Re-sorted ${r.changed} transactions.${r.backup ? ` Backup saved to ${r.backup}` : ""}`);
      setReport(null);
      refreshAll();
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Re-sort failed");
    } finally {
      setBusy(false);
    }
  }

  const rename = (kind: "group" | "category", id: number, name: string) =>
    run(() =>
      api(kind === "group" ? `/api/finance/category-groups/${id}` : `/api/finance/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      })
    );

  const groupName = (id: number | null) => taxonomy.groups.find((g) => g.id === id)?.name ?? "";
  const cat = (id: number | null) => taxonomy.categories.find((c) => c.id === id);
  const budgetLabel = (b: Budget) =>
    b.group_id != null
      ? `${groupName(b.group_id)} (whole group)`
      : `${groupName(cat(b.category_id)?.group_id ?? null)} › ${cat(b.category_id)?.name ?? "?"}`;
  const shownRules = rules.filter(
    (r) => !ruleSearch.trim() || r.match_key.includes(ruleSearch.trim().toLowerCase())
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Re-sort */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Sort past transactions</h3>
        <p className="text-xs text-faint">
          New statements are sorted as they&apos;re imported. This applies the current labels and
          rules to everything already imported: categories you picked by hand stay put, then
          your merchant rules, the card issuer&apos;s label and the keyword rules decide, and
          monthly repeat charges become Subscriptions. Preview first; nothing changes until you
          apply, and the database is backed up before it does.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={preview} disabled={busy} className={ghostBtnCls}>
            {report ? "Refresh preview" : "Preview re-sort"}
          </button>
          {report && (
            <>
              <button
                type="button"
                onClick={applyResort}
                disabled={busy || report.changes === 0}
                className={btnCls}
              >
                Apply ({report.changes} {report.changes === 1 ? "change" : "changes"})
              </button>
              <button type="button" onClick={() => setReport(null)} className={ghostBtnCls}>
                Cancel
              </button>
            </>
          )}
        </div>
        {report && (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-faint">
                <tr>
                  <th className="p-2 font-normal">Category</th>
                  <th className="p-2 text-right font-normal">Transactions</th>
                  <th className="p-2 text-right font-normal">Net total</th>
                  <th className="p-2 font-normal">Top merchants</th>
                </tr>
              </thead>
              <tbody>
                {report.categories.map((c) => (
                  <tr key={c.category_id ?? "none"} className="border-t border-line align-top">
                    <td className={`p-2 ${c.category_id == null ? "text-[#e6a23c]" : "text-prose"}`}>
                      {c.group && <span className="text-xs text-faint">{c.group} › </span>}
                      {c.name}
                    </td>
                    <td className="p-2 text-right tabular-nums text-subtle">{c.count}</td>
                    <td className="p-2 text-right tabular-nums text-prose">{fmtUSD(c.total)}</td>
                    <td className="p-2 text-xs text-faint">
                      {c.top_merchants.map((m) => `${m.name} ${fmtUSD(m.total, 0)}`).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.subscriptions.length > 0 && (
              <p className="border-t border-line p-2 text-xs text-faint">
                Monthly charges found:{" "}
                {report.subscriptions.map((s) => `${s.name} ${fmtUSD(s.amount)}`).join(" · ")}
              </p>
            )}
            <p className="border-t border-line p-2 text-xs text-faint">
              Something in the wrong place? Fix one of its transactions under Spending (that teaches
              its merchant), or add a rule below, then refresh the preview.
            </p>
          </div>
        )}
      </div>

      {/* Groups & categories */}
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-medium text-subtle">Groups &amp; categories</h3>
        <p className="text-xs text-faint">
          Rename anything — click a name and type. Built-in categories keep their keyword rules
          when renamed.
        </p>
        {taxonomy.groups.map((g) => {
          const cats = taxonomy.categories.filter((c) => c.group_id === g.id);
          return (
            <div key={g.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <input
                  key={g.name}
                  defaultValue={g.name}
                  aria-label="Group name"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== g.name) rename("group", g.id, next);
                  }}
                  className="w-48 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-prose outline-none hover:border-line focus:border-accent"
                />
                <span className="text-xs text-faint">group</span>
                {cats.length === 0 && (
                  <button
                    type="button"
                    onClick={() => run(() => api(`/api/finance/category-groups/${g.id}`, { method: "DELETE" }))}
                    className={`ml-auto ${delBtnCls}`}
                  >
                    delete group
                  </button>
                )}
              </div>
              <ul className="mt-2">
                {cats.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5 pl-4 text-sm">
                    <input
                      key={c.name}
                      defaultValue={c.name}
                      aria-label="Category name"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== c.name) rename("category", c.id, next);
                      }}
                      className="w-48 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-subtle outline-none hover:border-line focus:border-accent"
                    />
                    <select
                      aria-label={`Group for ${c.name}`}
                      value={c.group_id}
                      onChange={(e) =>
                        run(() =>
                          api(`/api/finance/categories/${c.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ group_id: Number(e.target.value) }),
                          })
                        )
                      }
                      className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-faint outline-none focus:border-accent"
                    >
                      {taxonomy.groups.map((o) => (
                        <option key={o.id} value={o.id}>
                          in {o.name}
                        </option>
                      ))}
                    </select>
                    <span className="ml-auto" />
                    {deleting?.id === c.id ? (
                      <span className="flex items-center gap-1.5 text-xs text-faint">
                        move its transactions to
                        <CategorySelect
                          value={deleting.moveTo}
                          onChange={(id) => setDeleting({ id: c.id, moveTo: id })}
                          taxonomy={{ ...taxonomy, categories: taxonomy.categories.filter((o) => o.id !== c.id) }}
                          className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-prose outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const moveTo = deleting.moveTo;
                            setDeleting(null);
                            run(
                              () =>
                                api(`/api/finance/categories/${c.id}`, {
                                  method: "DELETE",
                                  body: JSON.stringify({ move_to: moveTo }),
                                }),
                              `Deleted "${c.name}".`
                            );
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          delete
                        </button>
                        <button type="button" onClick={() => setDeleting(null)} className={linkBtnCls}>
                          cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleting({ id: c.id, moveTo: null })}
                        className={delBtnCls}
                      >
                        delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (newCat[g.id] ?? "").trim();
                  if (!name) return;
                  setNewCat({ ...newCat, [g.id]: "" });
                  run(() =>
                    api("/api/finance/categories", {
                      method: "POST",
                      body: JSON.stringify({ name, group_id: g.id }),
                    })
                  );
                }}
                className="mt-2 flex items-center gap-2 pl-4"
              >
                <input
                  placeholder={`New category in ${g.name}`}
                  value={newCat[g.id] ?? ""}
                  onChange={(e) => setNewCat({ ...newCat, [g.id]: e.target.value })}
                  className={`${inputCls} w-56 py-1 text-xs`}
                />
                <button className={ghostBtnCls} disabled={!(newCat[g.id] ?? "").trim()}>
                  Add
                </button>
              </form>
            </div>
          );
        })}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newGroup.trim();
            if (!name) return;
            setNewGroup("");
            run(() => api("/api/finance/categories", { method: "POST", body: JSON.stringify({ kind: "group", name }) }));
          }}
          className="flex items-center gap-2"
        >
          <input
            placeholder="New group"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            className={`${inputCls} w-56`}
          />
          <button className={ghostBtnCls} disabled={!newGroup.trim()}>
            Add group
          </button>
        </form>
      </div>

      {/* Merchant rules */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Learned merchants</h3>
        <p className="text-xs text-faint">
          Picking a transaction&apos;s category (under Spending, or in the import preview) teaches a
          rule, so that merchant lands there from then on. Rules beat the issuer&apos;s label and the
          keywords. Widen the match text to cover more variants.
        </p>
        {rules.length > 8 && (
          <input
            type="search"
            placeholder="Search merchants…"
            value={ruleSearch}
            onChange={(e) => setRuleSearch(e.target.value)}
            className={`${inputCls} w-56`}
          />
        )}
        <ul>
          {shownRules.map((r) => (
            <Row key={`${r.id}-${r.match_key}-${r.category_id}`}>
              <input
                defaultValue={r.match_key}
                aria-label="Match text"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== r.match_key)
                    run(() =>
                      api(`/api/finance/merchant-rules/${r.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ match_key: next, category_id: r.category_id }),
                      })
                    );
                }}
                className="w-48 rounded border border-line bg-canvas px-1.5 py-1 font-mono text-xs text-prose outline-none focus:border-accent"
              />
              <span className="text-xs text-faint">→</span>
              <CategorySelect
                value={r.category_id}
                onChange={(category_id) =>
                  run(() =>
                    api(`/api/finance/merchant-rules/${r.id}`, {
                      method: "PUT",
                      body: JSON.stringify({ match_key: r.match_key, category_id }),
                    })
                  )
                }
                taxonomy={taxonomy}
                ariaLabel={`Category for ${r.match_key}`}
                className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-prose outline-none focus:border-accent"
              />
              <span className="ml-auto" />
              <button
                onClick={() => run(() => api(`/api/finance/merchant-rules/${r.id}`, { method: "DELETE" }))}
                className={delBtnCls}
              >
                delete
              </button>
            </Row>
          ))}
          {rules.length === 0 && (
            <p className="py-3 text-sm text-faint">
              No rules yet. Recategorize a transaction under Spending and one appears here.
            </p>
          )}
        </ul>
      </div>

      {/* Budgets */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-subtle">Monthly budgets</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const [kind, id] = budgetForm.target.split(":");
            run(
              () =>
                api("/api/finance/budgets", {
                  method: "POST",
                  body: JSON.stringify({
                    [kind === "g" ? "group_id" : "category_id"]: Number(id),
                    monthly_limit: Number(budgetForm.monthly_limit),
                  }),
                }),
              "Budget saved."
            );
            setBudgetForm({ ...budgetForm, monthly_limit: "" });
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <Field label="For">
            <select
              required
              value={budgetForm.target}
              onChange={(e) => setBudgetForm({ ...budgetForm, target: e.target.value })}
              className={inputCls}
            >
              <option value="">Choose…</option>
              <optgroup label="Whole group">
                {taxonomy.groups.map((g) => (
                  <option key={g.id} value={`g:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
              {taxonomy.groups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {taxonomy.categories
                    .filter((c) => c.group_id === g.id)
                    .map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Monthly limit">
            <input
              required
              type="number"
              step="0.01"
              min="0"
              value={budgetForm.monthly_limit}
              onChange={(e) => setBudgetForm({ ...budgetForm, monthly_limit: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </Field>
          <button className={btnCls}>Set budget</button>
        </form>
        <ul>
          {budgets.map((b) => (
            <Row key={b.id}>
              <span className="text-prose">{budgetLabel(b)}</span>
              <span className="ml-auto tabular-nums text-subtle">{fmtUSD(b.monthly_limit)}/mo</span>
              <button
                onClick={() =>
                  run(() => api("/api/finance/budgets", { method: "DELETE", body: JSON.stringify({ id: b.id }) }))
                }
                className={delBtnCls}
              >
                delete
              </button>
            </Row>
          ))}
          {budgets.length === 0 && (
            <p className="py-4 text-sm text-faint">
              No budgets set. Budgets scale to whatever date range the dashboard shows.
            </p>
          )}
        </ul>
      </div>
    </div>
  );
}
