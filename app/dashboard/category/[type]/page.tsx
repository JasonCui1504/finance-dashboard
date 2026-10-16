export const dynamic = "force-dynamic";

import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { FINANCE_COOKIE, verifySessionToken } from "../../../../lib/finance/auth";
import {
  cdCurrentValue,
  cdMaturityValue,
  getLatestPrices,
  getSnapshotHistory,
  listAccounts,
  listCds,
  listHoldings,
  type AccountType,
  type Snapshot,
} from "../../../../lib/finance/queries";
import { CASH_TICKER } from "../../../../lib/finance/prices";
import NetWorthChart from "../../components/NetWorthChart";
import CdLadder from "../../components/CdLadder";
import { DELTA_DOWN, DELTA_UP, fmtDate, fmtPct, fmtUSD, SERIES } from "../../components/format";

type CategoryType = "brokerage" | "bank" | "cds" | "retirement";

const CONFIG: Record<
  CategoryType,
  { label: string; color: string; series: (s: Snapshot) => number; accountType?: AccountType }
> = {
  brokerage: {
    label: "Brokerage",
    color: SERIES.brokerage,
    series: (s) => s.total_brokerage,
    accountType: "brokerage",
  },
  bank: {
    label: "Bank",
    color: SERIES.bank,
    series: (s) => s.total_bank,
    accountType: "bank",
  },
  cds: { label: "CDs", color: SERIES.cds, series: (s) => s.total_cds },
  retirement: {
    label: "Retirement",
    color: SERIES.retirement,
    series: (s) => s.total_retirement,
    accountType: "retirement",
  },
};

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="fin-card fin-rise rounded-xl border border-line bg-surface p-5">
      {title && <h2 className="mb-4 text-sm font-medium text-subtle">{title}</h2>}
      {children}
    </section>
  );
}

type AccountTotals = Map<number, { value: number; cash: number }>;

/**
 * One account in a list. An account holding positions is valued from them
 * (cash included) — the same rule the snapshot uses — so its typed-in balance
 * only shows for accounts without any.
 */
function AccountItem({
  account: a,
  totals,
}: {
  account: Awaited<ReturnType<typeof listAccounts>>[number];
  totals: AccountTotals;
}) {
  const t = totals.get(a.id);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-prose">{a.name}</span>
      <span className="text-xs text-faint">
        {a.institution}
        {a.apy != null ? ` · ${a.apy}% APY` : ""}
      </span>
      <span className="ml-auto flex items-baseline gap-2 tabular-nums">
        {t && t.cash > 0 && (
          <span className="text-xs text-faint">{fmtUSD(t.cash)} cash</span>
        )}
        <span className="text-subtle">
          {t ? fmtUSD(t.value) : a.last_balance != null ? fmtUSD(a.last_balance) : "—"}
        </span>
      </span>
    </li>
  );
}

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(FINANCE_COOKIE)?.value)) {
    redirect("/dashboard/login");
  }

  const { type } = await params;
  if (!(type in CONFIG)) notFound();
  const cfg = CONFIG[type as CategoryType];

  const [history, accounts, holdings, prices, cds] = await Promise.all([
    getSnapshotHistory(),
    listAccounts(),
    listHoldings(),
    getLatestPrices(),
    listCds(),
  ]);

  const chartData = history.map((s) => ({ date: s.date, value: cfg.series(s) }));
  const current = history.length ? cfg.series(history[history.length - 1]) : 0;
  const prev = history.length >= 2 ? cfg.series(history[history.length - 2]) : null;
  const changePct = prev && prev !== 0 ? ((current - prev) / prev) * 100 : null;
  const now = new Date();

  const catAccounts = cfg.accountType
    ? accounts.filter((a) => a.type === cfg.accountType)
    : [];

  // Value and cash held in each account's positions.
  const totals: AccountTotals = new Map();
  for (const h of holdings) {
    if (h.account_id == null) continue;
    const price = prices.get(h.ticker.toUpperCase())?.price ?? h.manual_price ?? 0;
    const t = totals.get(h.account_id) ?? { value: 0, cash: 0 };
    t.value += h.shares * price;
    if (h.ticker.toUpperCase() === CASH_TICKER) t.cash += h.shares * price;
    totals.set(h.account_id, t);
  }
  // Positions in retirement accounts belong on the Retirement page.
  const retirementIds = new Set(
    accounts.filter((a) => a.type === "retirement").map((a) => a.id)
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="fin-rise flex items-baseline justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-faint transition-colors hover:text-subtle"
          >
            ← Dashboard
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: cfg.color }}
              aria-hidden
            />
            <h1 className="text-xl font-medium">{cfg.label}</h1>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl text-prose tabular-nums">{fmtUSD(current)}</p>
          {changePct != null && (
            <p
              className="text-sm"
              style={{ color: changePct >= 0 ? DELTA_UP : DELTA_DOWN }}
            >
              {fmtPct(changePct)} today
            </p>
          )}
        </div>
      </header>

      <Card title={`${cfg.label} over time`}>
        {chartData.length >= 2 ? (
          <NetWorthChart data={chartData} label={cfg.label} />
        ) : (
          <p className="py-8 text-center text-sm text-faint">
            Not enough history yet — the chart builds one snapshot per day.
          </p>
        )}
      </Card>

      {/* Brokerage: holdings + manual brokerage balances */}
      {type === "brokerage" && (
        <BrokerageBreakdown
          holdings={holdings.filter(
            (h) => h.account_id == null || !retirementIds.has(h.account_id)
          )}
          prices={prices}
          accounts={catAccounts}
          allAccounts={accounts}
          totals={totals}
        />
      )}

      {/* Bank / Retirement: account list */}
      {(type === "bank" || type === "retirement") && (
        <Card title="Accounts">
          {catAccounts.length === 0 ? (
            <p className="text-sm text-faint">No {cfg.label.toLowerCase()} accounts yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5 text-sm">
              {catAccounts.map((a) => (
                <AccountItem key={a.id} account={a} totals={totals} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* CDs: table + ladder */}
      {type === "cds" && (
        <>
          <Card title="Certificates of deposit">
            {cds.length === 0 ? (
              <p className="text-sm text-faint">No CDs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-faint">
                      <th className="pb-2 font-normal">Bank</th>
                      <th className="pb-2 text-right font-normal">Principal</th>
                      <th className="pb-2 text-right font-normal">APY</th>
                      <th className="pb-2 text-right font-normal">Value now</th>
                      <th className="pb-2 text-right font-normal">At maturity</th>
                      <th className="pb-2 text-right font-normal">Profit</th>
                      <th className="pb-2 text-right font-normal">Matures</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {cds.map((cd) => (
                      <tr key={cd.id} className="border-t border-line">
                        <td className="py-2 text-prose">{cd.bank_name}</td>
                        <td className="py-2 text-right text-subtle">{fmtUSD(cd.principal)}</td>
                        <td className="py-2 text-right text-subtle">{cd.apy.toFixed(2)}%</td>
                        <td className="py-2 text-right text-prose">
                          {fmtUSD(cdCurrentValue(cd, now))}
                        </td>
                        <td className="py-2 text-right text-prose">
                          {fmtUSD(cdMaturityValue(cd))}
                        </td>
                        <td className="py-2 text-right" style={{ color: DELTA_UP }}>
                          +{fmtUSD(cdMaturityValue(cd) - cd.principal)}
                        </td>
                        <td className="py-2 text-right text-subtle">
                          {fmtDate(cd.maturity_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {cds.length > 0 && (
            <Card title="CD ladder">
              <CdLadder
                nowMs={now.getTime()}
                cds={cds.map((cd) => ({
                  id: cd.id,
                  bank_name: cd.bank_name,
                  principal: cd.principal,
                  apy: cd.apy,
                  open_date: cd.open_date,
                  maturity_date: cd.maturity_date,
                }))}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function BrokerageBreakdown({
  holdings,
  prices,
  accounts,
  allAccounts,
  totals,
}: {
  holdings: Awaited<ReturnType<typeof listHoldings>>;
  prices: Awaited<ReturnType<typeof getLatestPrices>>;
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  allAccounts: Awaited<ReturnType<typeof listAccounts>>;
  totals: AccountTotals;
}) {
  const accountName = new Map(allAccounts.map((a) => [a.id, a.name]));
  const rows = holdings.map((h) => {
    const q = prices.get(h.ticker.toUpperCase());
    const price = q?.price ?? h.manual_price ?? null;
    const value = price != null ? h.shares * price : null;
    const dayPct = q && q.prev_close ? ((q.price - q.prev_close) / q.prev_close) * 100 : null;
    return { ...h, price, value, dayPct };
  });

  return (
    <>
      {rows.length > 0 && (
        <Card title="Holdings">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="pb-2 font-normal">Ticker</th>
                  <th className="pb-2 text-right font-normal">Shares</th>
                  <th className="pb-2 text-right font-normal">Price</th>
                  <th className="pb-2 text-right font-normal">Value</th>
                  <th className="pb-2 text-right font-normal">Day</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="py-2 text-prose">
                      {h.ticker}{" "}
                      <span className="text-xs text-faint">
                        {(h.account_id != null && accountName.get(h.account_id)) || h.broker || ""}
                      </span>
                    </td>
                    <td className="py-2 text-right text-subtle">
                      {h.ticker === CASH_TICKER ? "cash" : h.shares}
                    </td>
                    <td className="py-2 text-right text-subtle">
                      {h.price != null ? fmtUSD(h.price, 2) : "—"}
                    </td>
                    <td className="py-2 text-right text-prose">
                      {h.value != null ? fmtUSD(h.value) : "—"}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{
                        color: h.dayPct == null ? undefined : h.dayPct >= 0 ? DELTA_UP : DELTA_DOWN,
                      }}
                    >
                      {h.dayPct != null ? fmtPct(h.dayPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {accounts.length > 0 && (
        <Card title="Brokerage accounts">
          <ul className="flex flex-col gap-2.5 text-sm">
            {accounts.map((a) => (
              <AccountItem key={a.id} account={a} totals={totals} />
            ))}
          </ul>
        </Card>
      )}
      {rows.length === 0 && accounts.length === 0 && (
        <Card>
          <p className="text-sm text-faint">No holdings or brokerage accounts yet.</p>
        </Card>
      )}
    </>
  );
}
