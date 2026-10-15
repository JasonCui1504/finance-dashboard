"use client";

import { useState } from "react";
import CategoryBreakdown from "./CategoryBreakdown";
import CategoryDonut from "./CategoryDonut";
import { fmtUSD } from "./format";

// Mirrors CARD_CREDITS in lib/finance/queries.ts (kept here: this is a client component).
const CARD_CREDITS = "Card credits";

type Point = { month: string; category: string; total: number };
type Budget = { category: string; monthly_limit: number };

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default function SpendingByMonth({
  data,
  budgets,
  currentMonth,
  month: controlledMonth,
  onMonthChange,
}: {
  data: Point[];
  budgets: Budget[];
  currentMonth: string;
  /** When given, the month is controlled by the parent (shared with the card above). */
  month?: string;
  onMonthChange?: (month: string) => void;
}) {
  // Newest first, so index 0 is the most recent month with activity.
  const months = [...new Set(data.map((d) => d.month))].sort((a, b) =>
    b.localeCompare(a)
  );
  const [ownMonth, setOwnMonth] = useState(
    months.includes(currentMonth) ? currentMonth : (months[0] ?? currentMonth)
  );
  const month = controlledMonth ?? ownMonth;
  const setMonth = onMonthChange ?? setOwnMonth;

  if (months.length === 0) return null;

  const i = months.indexOf(month);
  const rows = data
    .filter((d) => d.month === month)
    .map(({ category, total }) => ({ category, total }));
  const monthTotal = rows.reduce((s, c) => s + c.total, 0);
  // Card credits sit apart from the categories (they reimburse other spending).
  const credits = rows.find((r) => r.category === CARD_CREDITS)?.total ?? 0;
  const spend = rows.filter((r) => r.category !== CARD_CREDITS);

  // Compared against the three months immediately before the one on screen —
  // not before today — so the figure still means something when browsing back.
  // Months a category didn't appear in count as zero, otherwise a brand-new
  // category would read as flat rather than new.
  const baselineMonths = months.slice(i + 1, i + 4);
  const trend = new Map<string, number>();
  if (baselineMonths.length > 0) {
    for (const { category, total } of spend) {
      const past = baselineMonths.map(
        (m) =>
          data.find((d) => d.month === m && d.category === category)?.total ?? 0
      );
      const avg = past.reduce((s, v) => s + v, 0) / past.length;
      if (avg <= 0 || total <= 0) continue;
      const pct = ((total - avg) / avg) * 100;
      // A flat month would render "0%", which is clutter rather than news.
      if (Math.abs(pct) >= 1) trend.set(category, pct);
    }
  }

  // months is newest-first, so "older" steps forward through the array.
  const older = i >= 0 && i < months.length - 1 ? months[i + 1] : null;
  const newer = i > 0 ? months[i - 1] : null;

  const navBtn =
    "rounded-md border border-line px-2 py-1 text-sm text-subtle transition-colors hover:border-accent hover:text-prose disabled:opacity-35 disabled:hover:border-line disabled:hover:text-subtle";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-faint">Breakdown for</p>
        {controlledMonth ? (
          <p className="text-sm text-prose">{monthLabel(month)}</p>
        ) : (
          <>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => older && setMonth(older)}
              disabled={!older}
              aria-label="Previous month"
              className={navBtn}
            >
              ←
            </button>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month to break down"
              className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-prose outline-none transition-colors focus:border-accent"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => newer && setMonth(newer)}
              disabled={!newer}
              aria-label="Next month"
              className={navBtn}
            >
              →
            </button>
          </div>
          </>
        )}
        <p className="text-sm tabular-nums text-prose">{fmtUSD(monthTotal)}</p>
        {month === currentMonth && (
          <span className="text-xs text-faint">this month</span>
        )}
        {credits !== 0 && (
          <span className="text-xs text-faint">
            includes <span className="tabular-nums text-[#17a06b]">{fmtUSD(credits)}</span> of card credits
          </span>
        )}
      </div>
      {i === -1 && <p className="text-sm text-faint">No category breakdown for this month yet.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">
        <CategoryDonut
          slices={spend.map((s) => ({ label: s.category, value: s.total }))}
        />
        <div>
          <p className="mb-3 text-xs text-faint">
            By category{budgets.length > 0 ? " · vs budget" : ""}
            {baselineMonths.length > 0 ? " · % vs 3-mo avg" : ""}
          </p>
          <CategoryBreakdown spend={spend} budgets={budgets} trend={trend} />
        </div>
      </div>
    </div>
  );
}
