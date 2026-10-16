"use client";

import { useState } from "react";
import { fmtUSD } from "./format";

export type BreakdownCategory = {
  key: string;
  name: string;
  total: number;
  /** Same category in the comparison window; null when not comparable. */
  prev: number | null;
  /** Budget scaled to the window, if one is set. */
  budget: number | null;
  merchants: { name: string; total: number }[];
};

export type BreakdownGroup = BreakdownCategory & {
  color: string;
  categories: BreakdownCategory[];
};

const OVER = "#e66767";
const GOOD = "#199e70";

function Trend({ total, prev, label }: { total: number; prev: number | null; label: string }) {
  if (prev == null || prev <= 0 || total <= 0) return null;
  const pct = ((total - prev) / prev) * 100;
  // A flat change would render "0%", which is clutter rather than news.
  if (Math.abs(pct) < 1) return null;
  // Spending more than before is the notable direction, so it gets the warm colour.
  return (
    <span className="text-xs tabular-nums" style={{ color: pct > 0 ? OVER : GOOD }} title={label}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

function Bar({ total, budget, max, color }: { total: number; budget: number | null; max: number; color: string }) {
  const over = budget != null && budget > 0 && total > budget;
  const denom = budget != null && budget > 0 ? budget : max;
  // A category whose returns outweigh its purchases nets negative: no bar.
  const width = Math.max(0, Math.min(100, (total / Math.max(denom, 1)) * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
      <div
        className="h-full rounded-full"
        style={{ width: `${width}%`, background: over ? OVER : budget != null ? GOOD : color }}
      />
    </div>
  );
}

function Amount({ total, budget }: { total: number; budget: number | null }) {
  const over = budget != null && budget > 0 && total > budget;
  return (
    <span className="tabular-nums text-prose">
      {fmtUSD(total)}
      {budget != null && (
        <span className="ml-1.5 text-xs" style={{ color: over ? OVER : "#8aa498" }}>
          / {fmtUSD(budget)}
        </span>
      )}
    </span>
  );
}

/**
 * Spending by group (Fixed, Essentials, …): click a group for its
 * categories, a category for where the money went.
 */
export default function GroupBreakdown({
  groups,
  trendLabel,
}: {
  groups: BreakdownGroup[];
  trendLabel: string;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const shown = groups.filter((g) => Math.abs(g.total) >= 0.005);
  if (shown.length === 0) {
    return <p className="text-sm text-faint">No spending in this period.</p>;
  }
  const max = Math.max(...shown.map((g) => g.total), 1);

  return (
    <ul className="flex flex-col gap-1">
      {shown.map((g) => {
        const open = openGroup === g.key;
        const cats = g.categories.filter((c) => Math.abs(c.total) >= 0.005);
        const catMax = Math.max(...cats.map((c) => c.total), 1);
        return (
          <li key={g.key} className="rounded-md">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => {
                setOpenGroup(open ? null : g.key);
                setOpenCat(null);
              }}
              className="flex w-full flex-col gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-lift/40"
            >
              <span className="flex w-full items-baseline gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ background: g.color }} aria-hidden />
                <span className="text-prose">{g.name}</span>
                <Trend total={g.total} prev={g.prev} label={trendLabel} />
                <span className="ml-auto" />
                <Amount total={g.total} budget={g.budget} />
                <span className="w-3 text-xs text-faint" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
              </span>
              <Bar total={g.total} budget={g.budget} max={max} color={g.color} />
            </button>
            {open && (
              <ul className="mb-2 ml-[18px] flex flex-col gap-0.5 border-l border-line pl-3">
                {cats.map((c) => {
                  const catOpen = openCat === c.key;
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        aria-expanded={catOpen}
                        onClick={() => setOpenCat(catOpen ? null : c.key)}
                        className="flex w-full flex-col gap-1 rounded px-2 py-1.5 text-left transition-colors hover:bg-lift/40"
                      >
                        <span className="flex w-full items-baseline gap-2 text-sm">
                          <span className="text-subtle">{c.name}</span>
                          <Trend total={c.total} prev={c.prev} label={trendLabel} />
                          <span className="ml-auto" />
                          <Amount total={c.total} budget={c.budget} />
                          <span className="w-3 text-xs text-faint" aria-hidden>
                            {c.merchants.length > 0 ? (catOpen ? "▾" : "▸") : ""}
                          </span>
                        </span>
                        <Bar total={c.total} budget={c.budget} max={catMax} color={g.color} />
                      </button>
                      {catOpen && c.merchants.length > 0 && (
                        <ul className="mb-1 ml-2 flex flex-col gap-0.5 py-1 pl-2 text-xs">
                          {c.merchants.map((m) => (
                            <li key={m.name} className="flex items-baseline gap-2">
                              <span className="truncate text-faint">{m.name}</span>
                              <span className="ml-auto tabular-nums text-subtle">{fmtUSD(m.total)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
