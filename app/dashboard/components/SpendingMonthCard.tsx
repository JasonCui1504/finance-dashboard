"use client";

import { useState } from "react";
import { DELTA_DOWN, DELTA_UP, fmtPct, fmtUSD } from "./format";
import SpendingByMonth from "./SpendingByMonth";
import SpendingChart from "./SpendingChart";

type CardRef = { id: number; name: string; issuer: string };
type BillRef = { id: number; name: string; amount: number };

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function prevMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
}

/**
 * The spending card's month view: pick a month and the total, the change from
 * the month before, each card, each bill, and the category breakdown below
 * all follow it.
 */
export default function SpendingMonthCard({
  cards,
  cardMonths,
  bills,
  billPayments,
  monthlySpending,
  categorySpendByMonth,
  budgets,
  currentMonth,
}: {
  cards: CardRef[];
  cardMonths: { card_id: number; month: string; total: number }[];
  bills: BillRef[];
  billPayments: { bill_id: number; month: string; amount: number }[];
  monthlySpending: { month: string; total: number }[];
  categorySpendByMonth: { month: string; category: string; total: number }[];
  budgets: { category: string; monthly_limit: number }[];
  currentMonth: string;
}) {
  // Every month with any spending, plus the current one; newest first.
  const months = [
    ...new Set([currentMonth, ...monthlySpending.map((m) => m.month), ...categorySpendByMonth.map((c) => c.month)]),
  ].sort((a, b) => b.localeCompare(a));
  const [month, setMonth] = useState(currentMonth);
  const i = months.indexOf(month);
  const older = i < months.length - 1 ? months[i + 1] : null;
  const newer = i > 0 ? months[i - 1] : null;

  const totalFor = (m: string) => monthlySpending.find((x) => x.month === m)?.total ?? null;
  const total = totalFor(month) ?? 0;
  const before = totalFor(prevMonth(month));
  const changePct = before ? ((total - before) / before) * 100 : null;
  const cardAmt = (id: number) => cardMonths.find((c) => c.card_id === id && c.month === month)?.total;
  const loggedBills = bills
    .map((b) => ({ ...b, logged: billPayments.find((p) => p.bill_id === b.id && p.month === month) }))
    .filter((b) => b.logged);
  const unloggedBills = bills.filter((b) => !loggedBills.some((l) => l.id === b.id));

  const navBtn =
    "rounded-md border border-line px-2 py-1 text-sm text-subtle transition-colors hover:border-accent hover:text-prose disabled:opacity-35 disabled:hover:border-line disabled:hover:text-subtle";

  return (
    <>
      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => older && setMonth(older)} disabled={!older} aria-label="Previous month" className={navBtn}>
              ←
            </button>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-prose outline-none focus:border-accent"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === currentMonth ? " (this month)" : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => newer && setMonth(newer)} disabled={!newer} aria-label="Next month" className={navBtn}>
              →
            </button>
          </div>
          <p className="mt-3 text-3xl text-prose tabular-nums">{fmtUSD(total)}</p>
          <p className="mt-0.5 text-xs text-faint">
            {month === currentMonth ? "so far this month" : monthLabel(month)}
            {changePct != null && (
              <span className="ml-1.5" style={{ color: changePct <= 0 ? DELTA_UP : DELTA_DOWN }}>
                {fmtPct(changePct)} vs {monthLabel(prevMonth(month)).split(" ")[0]}
              </span>
            )}
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {cards.map((c) => {
              const amt = cardAmt(c.id);
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
                <span className="ml-auto tabular-nums text-prose">{fmtUSD(b.logged!.amount)}</span>
              </li>
            ))}
            {unloggedBills.map((b) => (
              <li key={`unlogged-${b.id}`} className="flex items-baseline gap-2">
                <span className="text-faint">{b.name}</span>
                <span className="text-xs text-faint">bill · not logged</span>
                <span className="ml-auto tabular-nums text-faint">usually {fmtUSD(b.amount, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs text-faint">Total spend by month</p>
          <SpendingChart data={monthlySpending} />
        </div>
      </div>
      {categorySpendByMonth.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <SpendingByMonth
            data={categorySpendByMonth}
            budgets={budgets}
            currentMonth={currentMonth}
            month={month}
            onMonthChange={setMonth}
          />
        </div>
      )}
    </>
  );
}
