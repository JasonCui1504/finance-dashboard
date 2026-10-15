"use client";

import { useState } from "react";
import IncomeVsSpending from "./IncomeVsSpending";
import PaycheckChart from "./PaycheckChart";

type Paycheck = { date: string; net: number; tax: number; gross: number };
type Month = { month: string; income: number; tax: number; spending: number };

const VIEWS = [
  { key: "paycheck", label: "Per paycheck" },
  { key: "month", label: "Per month" },
] as const;

/**
 * One income chart, two grains: each paycheck's take-home and tax, or each
 * month's pay beside that month's spending.
 */
export default function IncomeChart({
  paychecks,
  months,
  currentMonth,
}: {
  paychecks: Paycheck[];
  months: Month[];
  currentMonth: string;
}) {
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("paycheck");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              view === v.key ? "bg-lift text-prose" : "text-faint hover:text-subtle"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "paycheck" ? (
        <PaycheckChart data={paychecks} />
      ) : (
        <IncomeVsSpending data={months} currentMonth={currentMonth} />
      )}
    </div>
  );
}
