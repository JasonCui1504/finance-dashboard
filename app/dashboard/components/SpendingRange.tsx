"use client";

import { useState } from "react";
import CategoryBreakdown from "./CategoryBreakdown";
import CategoryDonut from "./CategoryDonut";
import { DELTA_DOWN, DELTA_UP, fmtPct, fmtUSD } from "./format";
import SpendingRangeChart, { shortDate, type SpendBucket } from "./SpendingRangeChart";

// Mirrors CARD_CREDITS in lib/finance/queries.ts (kept here: this is a client component).
const CARD_CREDITS = "Card credits";
const DAYS_PER_MONTH = 365.25 / 12;

type CardRef = { id: number; name: string; issuer: string };
type BillRef = { id: number; name: string };
type Day = { date: string; card_id: number; category: string; spent: number; returned: number };
type Monthly = {
  month: string;
  card_id: number | null;
  bill_id: number | null;
  category: string;
  amount: number;
};

type Preset = "30" | "90" | "ytd" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

// --- dates as YYYY-MM-DD strings, in UTC like the rest of the dashboard ---
const toDate = (d: string) => new Date(d + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
const dayCount = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
function shiftYear(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return iso(x);
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function longDate(d: string): string {
  return toDate(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Days of `ym` that fall inside [from, to]. */
function overlap(ym: string, from: string, to: string): [string, string] | null {
  const a = `${ym}-01`;
  const b = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
  const lo = a > from ? a : from;
  const hi = b < to ? b : to;
  return lo <= hi ? [lo, hi] : null;
}

type Totals = {
  spent: number;
  returned: number;
  byCard: Map<number, number>;
  byBill: Map<number, number>;
  byCategory: Map<string, number>;
};

/** Net spending in [from, to]; monthly-only amounts count pro rata by day. */
function totalsFor(days: Day[], monthly: Monthly[], from: string, to: string): Totals {
  const t: Totals = { spent: 0, returned: 0, byCard: new Map(), byBill: new Map(), byCategory: new Map() };
  const add = <K,>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    t.spent += d.spent;
    t.returned += d.returned;
    add(t.byCard, d.card_id, d.spent + d.returned);
    add(t.byCategory, d.category, d.spent + d.returned);
  }
  for (const m of monthly) {
    const o = overlap(m.month, from, to);
    if (!o) continue;
    const share = (m.amount * dayCount(o[0], o[1])) / daysInMonth(m.month);
    t.spent += share;
    if (m.card_id != null) add(t.byCard, m.card_id, share);
    if (m.bill_id != null) add(t.byBill, m.bill_id, share);
    add(t.byCategory, m.category, share);
  }
  return t;
}

/** Buckets of `size` days ending on `to`, so the newest bar is always whole. */
function bucketsFor(days: Day[], monthly: Monthly[], from: string, to: string, size: number): SpendBucket[] {
  const perDay = new Map<string, { spent: number; returned: number }>();
  const bump = (date: string, spent: number, returned: number) => {
    const v = perDay.get(date) ?? { spent: 0, returned: 0 };
    v.spent += spent;
    v.returned += returned;
    perDay.set(date, v);
  };
  for (const d of days) if (d.date >= from && d.date <= to) bump(d.date, d.spent, d.returned);
  for (const m of monthly) {
    const o = overlap(m.month, from, to);
    if (!o) continue;
    const daily = m.amount / daysInMonth(m.month);
    for (let d = o[0]; d <= o[1]; d = addDays(d, 1)) bump(d, daily, 0);
  }
  const out: SpendBucket[] = [];
  for (let end = to; end >= from; end = addDays(end, -size)) {
    const start = addDays(end, -(size - 1)) < from ? from : addDays(end, -(size - 1));
    const b: SpendBucket = { start, end, spent: 0, returned: 0 };
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const v = perDay.get(d);
      if (v) {
        b.spent += v.spent;
        b.returned += v.returned;
      }
    }
    out.push(b);
  }
  return out.reverse();
}

const autoBarDays = (len: number) => (len <= 45 ? 2 : len <= 120 ? 3 : 7);

/**
 * Spending over a chosen window (rolling 30 / 90 days, year to date, or any
 * dates) instead of calendar months, so a return a few weeks after the
 * purchase lands in the same window rather than flattering the next month.
 */
export default function SpendingRange({
  cards,
  bills,
  days,
  monthly,
  budgets,
  today,
}: {
  cards: CardRef[];
  bills: BillRef[];
  days: Day[];
  monthly: Monthly[];
  budgets: { category: string; monthly_limit: number }[];
  today: string;
}) {
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [barChoice, setBarChoice] = useState<"auto" | number>("auto");

  let from: string;
  let to = today;
  if (preset === "30") from = addDays(today, -29);
  else if (preset === "90") from = addDays(today, -89);
  else if (preset === "ytd") from = `${today.slice(0, 4)}-01-01`;
  else {
    from = custom.from <= custom.to ? custom.from : custom.to;
    to = custom.from <= custom.to ? custom.to : custom.from;
  }
  const len = dayCount(from, to);
  // Year to date compares with the same dates last year; any other window
  // with the same number of days just before it.
  const [prevFrom, prevTo] =
    preset === "ytd" ? [shiftYear(from, -1), shiftYear(to, -1)] : [addDays(from, -len), addDays(from, -1)];
  const barDays = barChoice === "auto" ? autoBarDays(len) : barChoice;

  const cur = totalsFor(days, monthly, from, to);
  const prev = totalsFor(days, monthly, prevFrom, prevTo);
  const buckets = bucketsFor(days, monthly, from, to, barDays);

  // Only compare when the data reaches back to the start of the earlier
  // window — otherwise it reads as a huge jump that's really missing data.
  const earliest = [days[0]?.date, ...monthly.map((m) => `${m.month}-01`)]
    .filter((d): d is string => !!d)
    .sort()[0];
  const comparable = earliest != null && earliest <= prevFrom;
  const net = cur.spent + cur.returned;
  const prevNet = prev.spent + prev.returned;
  const changePct = comparable && prevNet > 0 ? ((net - prevNet) / prevNet) * 100 : null;
  const prevLabel = preset === "ytd" ? "same period last year" : `previous ${len} days`;

  const credits = cur.byCategory.get(CARD_CREDITS) ?? 0;
  const spend = [...cur.byCategory.entries()]
    .filter(([c, v]) => c !== CARD_CREDITS && Math.abs(v) >= 0.005)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  const trend = new Map<string, number>();
  if (comparable) {
    for (const { category, total } of spend) {
      const before = prev.byCategory.get(category) ?? 0;
      if (before <= 0 || total <= 0) continue;
      const pct = ((total - before) / before) * 100;
      if (Math.abs(pct) >= 1) trend.set(category, pct);
    }
  }
  // Monthly budgets scaled to the window's length.
  const scaledBudgets = budgets.map((b) => ({
    category: b.category,
    monthly_limit: Math.round(((b.monthly_limit * len) / DAYS_PER_MONTH) * 100) / 100,
  }));
  const loggedBills = bills.filter((b) => (cur.byBill.get(b.id) ?? 0) > 0);

  const chip = (on: boolean) =>
    `rounded px-2.5 py-1 text-xs transition-colors ${on ? "bg-lift text-prose" : "text-faint hover:text-subtle"}`;
  const dateCls =
    "rounded-md border border-line bg-canvas px-2 py-1 text-xs text-prose outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-5">
      {/* One row of controls scoping everything below it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1 rounded-md border border-line p-0.5" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => setPreset(p.key)}
              className={chip(preset === p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-faint">
            <input
              type="date"
              aria-label="From"
              value={custom.from}
              max={today}
              onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
              className={dateCls}
            />
            to
            <input
              type="date"
              aria-label="To"
              value={custom.to}
              max={today}
              onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
              className={dateCls}
            />
          </div>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-faint">
          Each bar
          <select
            value={String(barChoice)}
            onChange={(e) => setBarChoice(e.target.value === "auto" ? "auto" : Number(e.target.value))}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-prose outline-none focus:border-accent"
          >
            <option value="auto">auto ({autoBarDays(len)} days)</option>
            <option value="1">1 day</option>
            <option value="2">2 days</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
            <option value="14">2 weeks</option>
          </select>
        </label>
      </div>

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <div>
          <p className="text-3xl text-prose tabular-nums">{fmtUSD(net)}</p>
          <p className="mt-0.5 text-xs text-faint">
            {longDate(from)} – {longDate(to)} · {len} {len === 1 ? "day" : "days"}
          </p>
          {changePct != null && (
            <p className="mt-0.5 text-xs" style={{ color: changePct <= 0 ? DELTA_UP : DELTA_DOWN }}>
              {fmtPct(changePct, 0)} vs {prevLabel} ({fmtUSD(prevNet)})
            </p>
          )}
          <p className="mt-2 text-xs text-faint tabular-nums">
            {fmtUSD(cur.spent)} purchases
            {cur.returned !== 0 && <> · {fmtUSD(-cur.returned)} returns &amp; credits</>}
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {cards.map((c) => {
              const amt = cur.byCard.get(c.id);
              return (
                <li key={c.id} className="flex items-baseline gap-2">
                  <span className="text-subtle">{c.name}</span>
                  {c.issuer && <span className="text-xs text-faint">{c.issuer}</span>}
                  <span className="ml-auto tabular-nums text-prose">{amt != null ? fmtUSD(amt) : "—"}</span>
                </li>
              );
            })}
            {loggedBills.map((b) => (
              <li key={`bill-${b.id}`} className="flex items-baseline gap-2">
                <span className="text-subtle">{b.name}</span>
                <span className="text-xs text-faint">bill</span>
                <span className="ml-auto tabular-nums text-prose">{fmtUSD(cur.byBill.get(b.id)!)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SpendingRangeChart key={`${from}|${to}|${barDays}`} buckets={buckets} />
          <details className="mt-2 text-xs text-faint">
            <summary className="cursor-pointer select-none hover:text-subtle">Show as table</summary>
            <div className="mt-2 max-h-56 overflow-y-auto">
              <table className="w-full tabular-nums">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1 font-normal">Dates</th>
                    <th className="pb-1 text-right font-normal">Purchases</th>
                    <th className="pb-1 text-right font-normal">Returns &amp; credits</th>
                    <th className="pb-1 text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody className="text-subtle">
                  {[...buckets].reverse().map((b) => (
                    <tr key={b.start} className="border-t border-line">
                      <td className="py-1">
                        {b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} – ${shortDate(b.end)}`}
                      </td>
                      <td className="py-1 text-right">{fmtUSD(b.spent)}</td>
                      <td className="py-1 text-right">{b.returned ? fmtUSD(-b.returned) : "—"}</td>
                      <td className="py-1 text-right text-prose">{fmtUSD(b.spent + b.returned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs text-faint">By category</p>
          {credits !== 0 && (
            <span className="text-xs text-faint">
              total includes <span className="tabular-nums text-[#17a06b]">{fmtUSD(credits)}</span> of card credits
            </span>
          )}
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">
          <CategoryDonut slices={spend.filter((s) => s.total > 0).map((s) => ({ label: s.category, value: s.total }))} />
          <div>
            <p className="mb-3 text-xs text-faint">
              Net of returns
              {budgets.length > 0 ? ` · vs budget scaled to ${len} days` : ""}
              {trend.size > 0 ? ` · % vs ${prevLabel}` : ""}
            </p>
            <CategoryBreakdown
              spend={spend}
              budgets={scaledBudgets}
              trend={trend}
              trendLabel={`vs this category's spending in the ${prevLabel}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
