"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUSD, SERIES } from "./format";
import { prefersReducedMotion } from "./motion";

type Account = { type: string; last_balance: number | null; apy: number | null };
type Cd = { principal: number; apy: number; open_date: string; maturity_date: string };
type Income = { source_name: string; amount: number; frequency: string };

const PRESETS = [
  { label: "3 mo", months: 3 },
  { label: "6 mo", months: 6 },
  { label: "1 yr", months: 12 },
  { label: "2 yr", months: 24 },
] as const;

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

function cdValueAt(cd: Cd, at: Date): number {
  const open = new Date(cd.open_date + "T00:00:00Z").getTime();
  const maturity = new Date(cd.maturity_date + "T00:00:00Z").getTime();
  const t = Math.min(at.getTime(), maturity);
  const years = Math.max(0, (t - open) / YEAR_MS);
  return cd.principal * Math.pow(1 + cd.apy / 100, years);
}

function occurrences(frequency: string, days: number): number {
  switch (frequency) {
    case "weekly":
      return Math.floor(days / 7);
    case "biweekly":
      return Math.floor(days / 14);
    case "monthly":
      return Math.floor(days / 30.4375);
    default:
      return 0; // one-off / irregular income is not projected
  }
}

/** Count-up that re-animates whenever the target changes. */
function useAnimatedNumber(target: number, duration = 400): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      current.current = target;
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const from = current.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      current.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export default function ProjectionCard({
  accounts,
  cds,
  income,
  currentBrokerage,
  hidden = [],
}: {
  accounts: Account[];
  cds: Cd[];
  income: Income[];
  currentBrokerage: number;
  hidden?: string[];
}) {
  const [months, setMonths] = useState<number | null>(12);
  const [customDate, setCustomDate] = useState("");

  const target = useMemo(() => {
    if (customDate) {
      const d = new Date(customDate + "T00:00:00");
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) return d;
    }
    return addMonths(new Date(), months ?? 12);
  }, [months, customDate]);

  const projection = useMemo(() => {
    const now = new Date();
    const days = Math.max(0, (target.getTime() - now.getTime()) / 86_400_000);
    const years = days / 365.25;

    const cdsTotal = cds.reduce((sum, cd) => sum + cdValueAt(cd, target), 0);
    const matured = cds.filter(
      (cd) => new Date(cd.maturity_date + "T00:00:00Z") <= target
    ).length;

    const bank = accounts
      .filter((a) => a.type === "bank")
      .reduce((sum, a) => {
        const bal = a.last_balance ?? 0;
        return sum + (a.apy != null ? bal * Math.pow(1 + a.apy / 100, years) : bal);
      }, 0);

    const retirement = accounts
      .filter((a) => a.type === "retirement")
      .reduce((sum, a) => sum + (a.last_balance ?? 0), 0);

    const incomeTotal = income.reduce(
      (sum, i) => sum + i.amount * occurrences(i.frequency, days),
      0
    );

    // Stocks are carried flat at today's aggregate value — future market moves
    // aren't modeled, but the current value is counted.
    const stocks = currentBrokerage;

    return {
      days: Math.round(days),
      cdsTotal,
      matured,
      bank,
      retirement,
      incomeTotal,
      stocks,
      total: cdsTotal + bank + retirement + incomeTotal + stocks,
    };
  }, [accounts, cds, income, target, currentBrokerage]);

  const rows = [
    {
      key: "brokerage",
      label: "Stocks (today's value, held flat)",
      value: projection.stocks,
      color: SERIES.brokerage,
    },
    {
      key: "cds",
      label: `CDs (${projection.matured}/${cds.length} matured by then)`,
      value: projection.cdsTotal,
      color: SERIES.cds,
    },
    { key: "bank", label: "Bank accounts", value: projection.bank, color: SERIES.bank },
    {
      key: "retirement",
      label: "Retirement (carried flat)",
      value: projection.retirement,
      color: SERIES.retirement,
    },
    {
      key: "income",
      label: "Projected recurring income",
      value: projection.incomeTotal,
      color: "#4a7c59",
    },
  ].filter((r) => !hidden.includes(r.key));

  const visibleTotal = rows.reduce((sum, r) => sum + r.value, 0);
  const animatedTotal = useAnimatedNumber(visibleTotal);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.months}
            onClick={() => {
              setMonths(p.months);
              setCustomDate("");
            }}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              !customDate && months === p.months
                ? "bg-lift text-prose"
                : "text-faint hover:text-subtle"
            }`}
          >
            {p.label}
          </button>
        ))}
        <input
          type="date"
          value={customDate}
          onChange={(e) => setCustomDate(e.target.value)}
          className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-subtle outline-none focus:border-accent"
          aria-label="Custom projection date"
        />
      </div>

      <p className="text-xs text-faint">
        Projected on{" "}
        {target.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}{" "}
        ({projection.days} days out)
      </p>
      <p
        className="mt-1 text-3xl"
        style={{
          background: "linear-gradient(180deg, #ffffff 20%, var(--subtle))",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {fmtUSD(animatedTotal)}
      </p>

      <ul className="mt-4 flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: r.color }}
              aria-hidden
            />
            <span className="text-subtle">{r.label}</span>
            <span className="ml-auto text-prose tabular-nums">{fmtUSD(r.value)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        Stocks are counted at today&apos;s aggregate value and held flat (future
        market moves aren&apos;t modeled). CDs grow at APY (full maturity value
        once matured), cash is flat unless a savings APY is set, retirement is
        carried flat, and recurring income is summed by frequency.
      </p>
    </div>
  );
}
