export const dynamic = "force-dynamic";

import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FINANCE_COOKIE, verifySessionToken } from "../../lib/finance/auth";
import {
  cdCurrentValue,
  cdMaturityValue,
  getCardSpendForMonth,
  getDailySpending,
  getTickerIndustries,
  getBenefitProgress,
  getCardCreditsForYear,
  getCategorySpendByMonth,
  getCategorySpendForMonth,
  getUntaggedCardCredits,
  listCardBenefits,
  getLatestPrices,
  getLatestSnapshot,
  getMonthlySpending,
  getSettings,
  getSnapshotHistory,
  listAccounts,
  CARD_CREDITS,
  listBillPayments,
  listBills,
  listBudgets,
  listCds,
  listCreditCards,
  listDashboardWarnings,
  listHoldings,
  listIncomeStreams,
  monthlyEquivalent,
  type NetWorthCategory,
  type Snapshot,
} from "../../lib/finance/queries";
import { summarizePaychecks } from "../../lib/finance/paychecks";
import { summarizeTax } from "../../lib/finance/tax";
import AccessTimeline from "./components/AccessTimeline";
import CashFlowViews from "./components/CashFlowViews";
import ChatPanel from "./components/ChatPanel";
import CdInterestChart from "./components/CdInterestChart";
import Concentration from "./components/Concentration";
import HoldingsTreemap from "./components/HoldingsTreemap";
import IncomeChart from "./components/IncomeChart";
import NetWorthChart from "./components/NetWorthChart";
import AllocationDonut from "./components/AllocationDonut";
import CardCreditMeters from "./components/CardCreditMeters";
import CdLadder from "./components/CdLadder";
import ProjectionCard from "./components/ProjectionCard";
import SpendingRangeSection from "./components/SpendingRangeSection";
import StatTile from "./components/StatTile";
import WarningBanner from "./components/WarningBanner";
import { DELTA_DOWN, DELTA_UP, fmtDate, fmtPct, fmtUSD, SERIES } from "./components/format";

export const metadata = { title: "Dashboard" };

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="fin-rise mt-4 flex items-baseline justify-between border-b border-line pb-2">
      <h2 className="text-lg font-medium text-prose">{title}</h2>
      {subtitle && (
        <span className="text-sm text-faint tabular-nums">{subtitle}</span>
      )}
    </div>
  );
}

function Card({
  title,
  children,
  action,
  delay = 0,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <section
      className={`fin-card fin-rise rounded-xl border border-line bg-surface p-5 ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h2 className="text-sm font-medium text-subtle">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function IncomeStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-canvas/40 p-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 text-lg text-prose tabular-nums">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-faint tabular-nums">{sub}</dd>}
    </div>
  );
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(FINANCE_COOKIE)?.value)) {
    redirect("/dashboard/login");
  }

  const thisMonth = new Date().toISOString().slice(0, 7);
  // The spending heatmap covers the last 26 weeks.
  const heatmapStart = new Date();
  heatmapStart.setUTCDate(heatmapStart.getUTCDate() - 26 * 7);
  const heatmapFrom = heatmapStart.toISOString().slice(0, 10);

  const [
    snapshot,
    history,
    accounts,
    holdings,
    prices,
    cds,
    income,
    cards,
    monthlySpending,
    cardSpendThisMonth,
    categorySpend,
    categorySpendByMonth,
    budgets,
    settings,
    cardCredits,
    cardBenefits,
    benefitProgress,
    untaggedCredits,
    bills,
    billPayments,
    industries,
    dailySpending,
    warnings,
  ] = await Promise.all([
    getLatestSnapshot(),
    getSnapshotHistory(),
    listAccounts(),
    listHoldings(),
    getLatestPrices(),
    listCds(),
    listIncomeStreams(),
    listCreditCards(),
    getMonthlySpending(12),
    getCardSpendForMonth(thisMonth),
    getCategorySpendForMonth(thisMonth),
    getCategorySpendByMonth(),
    listBudgets(),
    getSettings(),
    getCardCreditsForYear(thisMonth.slice(0, 4)),
    listCardBenefits(),
    getBenefitProgress(thisMonth.slice(0, 4)),
    getUntaggedCardCredits(thisMonth.slice(0, 4)),
    listBills(),
    listBillPayments(),
    getTickerIndustries(),
    getDailySpending(heatmapFrom),
    listDashboardWarnings(),
  ]);

  // Net-worth categories the user has chosen to show. Everything net-worth
  // related (headline, chart, allocation, projection) is computed from the
  // visible components so the numbers always reconcile with the tiles shown.
  const hidden = new Set<NetWorthCategory>(settings.hidden_categories);
  const COMPONENTS: {
    key: NetWorthCategory;
    label: string;
    color: string;
    of: (s: Snapshot) => number;
  }[] = [
    { key: "brokerage", label: "Brokerage", color: SERIES.brokerage, of: (s) => s.total_brokerage },
    { key: "bank", label: "Bank", color: SERIES.bank, of: (s) => s.total_bank },
    { key: "cds", label: "CDs", color: SERIES.cds, of: (s) => s.total_cds },
    { key: "retirement", label: "Retirement", color: SERIES.retirement, of: (s) => s.total_retirement },
  ];
  const visibleComponents = COMPONENTS.filter((c) => !hidden.has(c.key));
  const visibleNetWorth = (s: Snapshot) =>
    visibleComponents.reduce((sum, c) => sum + c.of(s), 0);

  // Card credits aren't a spending category, so they can't be the "top" one.
  const topCategory = categorySpend.find((c) => c.category !== CARD_CREDITS && c.total > 0) ?? null;

  // Bills as logged for this month (feeds this month's total).
  const billName = new Map(bills.map((b) => [b.id, b.name]));
  const billsThisMonth = billPayments
    .filter((p) => p.month === thisMonth && billName.has(p.bill_id))
    .map((p) => ({ id: p.bill_id, name: billName.get(p.bill_id)!, amount: p.amount }));
  const thisMonthSpend =
    [...cardSpendThisMonth.values()].reduce((sum, v) => sum + v, 0) +
    billsThisMonth.reduce((sum, b) => sum + b.amount, 0);

  const chartData = history.map((s) => ({ date: s.date, value: visibleNetWorth(s) }));
  const spark = (pick: (s: (typeof history)[number]) => number) =>
    history.slice(-30).map(pick);
  const now = new Date();

  // Displayed net worth + day change from visible components only.
  const netWorthNow = snapshot ? visibleNetWorth(snapshot) : 0;
  const prevSnap = history.length >= 2 ? history[history.length - 2] : null;
  const prevNetWorth = prevSnap ? visibleNetWorth(prevSnap) : null;
  const change =
    prevNetWorth && prevNetWorth !== 0
      ? ((netWorthNow - prevNetWorth) / prevNetWorth) * 100
      : null;

  // --- Bank-update reminder (balances are manual; nudge if stale) ---
  const bankAccounts = accounts.filter((a) => a.type === "bank");
  const lastBankTs = bankAccounts
    .map((a) => a.balance_updated_at)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop();
  // SQLite datetime('now') is UTC ("YYYY-MM-DD HH:MM:SS"); normalize to parse.
  const bankDaysSince = lastBankTs
    ? Math.floor(
        (now.getTime() - new Date(lastBankTs.replace(" ", "T") + "Z").getTime()) /
          86_400_000
      )
    : null;
  const showBankReminder =
    bankAccounts.length > 0 && (bankDaysSince == null || bankDaysSince > 7);

  const tax = summarizeTax(income);
  const pay = summarizePaychecks(income, now.toISOString().slice(0, 10));

  // --- Emergency-fund runway + spending insights ---
  const cashOnHand = bankAccounts.reduce(
    (sum, a) => sum + (a.last_balance ?? 0),
    0
  );
  // Average of complete prior months (exclude the current, partial month).
  const priorMonths = monthlySpending.filter((m) => m.month !== thisMonth);
  const avgMonthlySpend =
    priorMonths.length > 0
      ? priorMonths.reduce((sum, m) => sum + m.total, 0) / priorMonths.length
      : thisMonthSpend || 0;
  const runwayMonths = avgMonthlySpend > 0 ? cashOnHand / avgMonthlySpend : null;
  const highestMonth =
    priorMonths.length > 0
      ? priorMonths.reduce((a, b) => (b.total > a.total ? b : a))
      : null;
  const thisVsAvgPct =
    avgMonthlySpend > 0 ? ((thisMonthSpend - avgMonthlySpend) / avgMonthlySpend) * 100 : null;

  // Take-home from recurring income (or, failing that, the average complete
  // month of logged paychecks) against the average of complete spending
  // months. The current month is partial, so measuring against it would
  // flatter the rate early in the month and wreck it late.
  const monthlyTakeHome = tax.monthlyNet > 0 ? tax.monthlyNet : (pay.avgMonthlyNet ?? 0);
  const savingsRate =
    monthlyTakeHome > 0 && avgMonthlySpend > 0
      ? ((monthlyTakeHome - avgMonthlySpend) / monthlyTakeHome) * 100
      : null;
  const monthName = (m: string) =>
    new Date(m + "-01T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

  const holdingRows = holdings.map((h) => {
    const q = prices.get(h.ticker.toUpperCase());
    const price = q?.price ?? h.manual_price ?? null;
    const value = price != null ? h.shares * price : null;
    const dayPct =
      q && q.prev_close ? ((q.price - q.prev_close) / q.prev_close) * 100 : null;
    return { ...h, price, value, dayPct };
  });

  const incomeStreams = income.filter((i) => i.frequency !== "paycheck");
  const recurringMonthly = income.reduce(
    (sum, i) => sum + (monthlyEquivalent(i) ?? 0),
    0
  );

  // Positions attached to an account value that account directly; its manual
  // balance is only a fallback, so the two are never summed. Mirrors the same
  // precedence used when the snapshot is computed.
  const valueByAccount = new Map<number, number>();
  for (const h of holdingRows) {
    if (h.account_id == null || h.value == null) continue;
    valueByAccount.set(h.account_id, (valueByAccount.get(h.account_id) ?? 0) + h.value);
  }
  const accountValue = (a: (typeof accounts)[number]) =>
    valueByAccount.get(a.id) ?? a.last_balance;

  // Group the unattached holdings by broker so each brokerage shows in Accounts
  // with its total, without needing a manually-created account row.
  const brokerGroups: { label: string; value: number }[] = [];
  if (!hidden.has("brokerage")) {
    const byBroker = new Map<string, number>();
    for (const h of holdingRows) {
      if (h.value == null || h.account_id != null) continue;
      const label = h.broker?.trim() || "Brokerage";
      byBroker.set(label, (byBroker.get(label) ?? 0) + h.value);
    }
    for (const [label, value] of byBroker) brokerGroups.push({ label, value });
    brokerGroups.sort((a, b) => b.value - a.value);
  }

  // --- Holdings map and concentration ---
  // Every priced position, combined by ticker, skipping hidden categories.
  // Unattached holdings count as brokerage; attached ones take their account's type.
  const accountType = new Map(accounts.map((a) => [a.id, a.type]));
  // retirementValue is the part held in retirement accounts, so the map can
  // leave it out on request.
  const byTicker = new Map<
    string,
    { ticker: string; value: number; retirementValue: number; dayPct: number | null }
  >();
  for (const h of holdingRows) {
    if (h.value == null || h.value <= 0) continue;
    const type = h.account_id == null ? "brokerage" : (accountType.get(h.account_id) ?? "brokerage");
    if (hidden.has(type as NetWorthCategory)) continue;
    const t = h.ticker.toUpperCase();
    const prev = byTicker.get(t);
    byTicker.set(t, {
      ticker: t,
      value: (prev?.value ?? 0) + h.value,
      retirementValue: (prev?.retirementValue ?? 0) + (type === "retirement" ? h.value : 0),
      dayPct: h.dayPct,
    });
  }

  // Last 12 months of logged take-home (and the tax withheld from it) beside
  // spending, trimmed to start at the first month with either.
  const takeHomeByMonth = new Map<string, number>();
  const taxByMonth = new Map<string, number>();
  for (const i of income) {
    if (i.frequency !== "paycheck" || !i.date_received) continue;
    const m = i.date_received.slice(0, 7);
    takeHomeByMonth.set(m, (takeHomeByMonth.get(m) ?? 0) + i.amount);
    taxByMonth.set(m, (taxByMonth.get(m) ?? 0) + (i.tax_withheld ?? 0));
  }
  const spendByMonth = new Map(monthlySpending.map((m) => [m.month, m.total]));
  const [cy, cm] = thisMonth.split("-").map(Number);
  const cashFlow = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(Date.UTC(cy, cm - 1 - (11 - k), 1));
    const month = d.toISOString().slice(0, 7);
    return {
      month,
      income: takeHomeByMonth.get(month) ?? 0,
      tax: taxByMonth.get(month) ?? 0,
      spending: spendByMonth.get(month) ?? 0,
    };
  });
  const firstActive = cashFlow.findIndex((m) => m.income > 0 || m.spending > 0);
  const cashFlowShown = firstActive === -1 ? [] : cashFlow.slice(firstActive);

  // --- Accessible vs. locked: what could be spent, and when ---
  const today = now.toISOString().slice(0, 10);
  const showCds = !hidden.has("cds");
  const maturedCds = showCds ? cds.filter((cd) => cd.maturity_date <= today) : [];
  const lockedCds = showCds ? cds.filter((cd) => cd.maturity_date > today) : [];
  const access = snapshot
    ? {
        cash:
          (hidden.has("bank") ? 0 : snapshot.total_bank) +
          maturedCds.reduce((s, cd) => s + cdMaturityValue(cd), 0),
        investments: hidden.has("brokerage") ? 0 : snapshot.total_brokerage,
        cdsLocked: lockedCds.reduce((s, cd) => s + cdCurrentValue(cd, now), 0),
        retirement: hidden.has("retirement") ? 0 : snapshot.total_retirement,
        unlocks: lockedCds.map((cd) => ({
          date: cd.maturity_date,
          label: cd.bank_name,
          value: cdMaturityValue(cd),
        })),
      }
    : null;

  // --- Cash flow: year to date, then each month this year with pay logged ---
  const flowPeriod = (key: string, label: string, inPeriod: (month: string) => boolean) => {
    const checks = pay.paychecks.filter((c) => inPeriod(c.date.slice(0, 7)));
    const cats = new Map<string, number>();
    for (const c of categorySpendByMonth) {
      if (inPeriod(c.month)) cats.set(c.category, (cats.get(c.category) ?? 0) + c.total);
    }
    return {
      key,
      label,
      gross: checks.reduce((s, c) => s + c.gross, 0),
      tax: checks.reduce((s, c) => s + c.tax, 0),
      net: checks.reduce((s, c) => s + c.net, 0),
      categories: [...cats.entries()].map(([name, total]) => ({ name, total })),
    };
  };
  const payMonths = [...new Set(pay.paychecks.map((c) => c.date.slice(0, 7)))].sort().reverse();
  // The running total starts at the first logged paycheck, so spending from
  // months before pay was recorded doesn't read as overspending.
  const firstPayMonth = payMonths[payMonths.length - 1] ?? thisMonth;
  const flowPeriods = [
    flowPeriod(
      "ytd",
      firstPayMonth.endsWith("-01")
        ? `${pay.year} to date`
        : `Since ${new Date(firstPayMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
      (m) => m >= firstPayMonth && m <= thisMonth
    ),
    ...payMonths.map((m) =>
      flowPeriod(
        m,
        new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        (x) => x === m
      )
    ),
  ];

  // Section groupings shown under the projection.
  const showSpending =
    cards.length > 0 ||
    bills.length > 0 || runwayMonths != null || priorMonths.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <WarningBanner warnings={warnings} />

      {showBankReminder && (
        <Link
          href="/dashboard/manage"
          className="fin-rise flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors"
          style={{ borderColor: "#fab21955", background: "#fab21912" }}
        >
          <span aria-hidden>🔔</span>
          <span className="text-subtle">
            {bankDaysSince != null
              ? `It's been ${bankDaysSince} days since you updated your bank balances.`
              : "Your bank balances may be out of date."}{" "}
            Keeping them current keeps net worth accurate.
          </span>
          <span className="ml-auto whitespace-nowrap text-accent">
            Update balances →
          </span>
        </Link>
      )}

      <header className="fin-rise flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-medium">Financial dashboard</h1>
          {snapshot && (
            <p className="mt-1 text-xs text-faint">
              Last snapshot: {fmtDate(snapshot.date)}
            </p>
          )}
        </div>
        <Link
          href="/dashboard/manage"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-prose"
        >
          Manage
        </Link>
      </header>

      {!snapshot ? (
        <Card>
          <p className="text-sm text-subtle">
            No snapshots yet. Add accounts and holdings under{" "}
            <Link href="/dashboard/manage" className="text-accent underline">
              Manage
            </Link>
            , then run the first refresh (or seed demo data in development).
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-6">
            <div className="col-span-2">
              <StatTile
                label="Net worth"
                value={netWorthNow}
                deltaPct={change}
                spark={spark(visibleNetWorth)}
                color={SERIES.brokerage}
                hero
              />
            </div>
            {visibleComponents.map((c, i) => (
              <StatTile
                key={c.key}
                label={c.label}
                value={c.of(snapshot)}
                spark={spark(c.of)}
                color={c.color}
                delay={60 * (i + 1)}
                href={`/dashboard/category/${c.key}`}
              />
            ))}
          </div>

          <Card title="Net worth over time" delay={120}>
            <NetWorthChart data={chartData} />
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Allocation" delay={180}>
              <AllocationDonut
                slices={visibleComponents.map((c) => ({
                  key: c.key,
                  label: c.label,
                  value: c.of(snapshot),
                }))}
              />
            </Card>
            <Card title="Accounts" delay={240}>
              {accounts.length === 0 && brokerGroups.length === 0 ? (
                <p className="text-sm text-faint">No accounts yet.</p>
              ) : (
                <ul className="flex flex-col gap-2.5 text-sm">
                  {/* Brokerages, grouped from holdings by their broker label */}
                  {brokerGroups.map((g) => (
                    <li key={`broker-${g.label}`} className="flex items-baseline gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 self-center rounded-full"
                        style={{ background: SERIES.brokerage }}
                        aria-hidden
                      />
                      <span className="text-prose">{g.label}</span>
                      <span className="text-xs text-faint">brokerage</span>
                      <span className="ml-auto text-subtle tabular-nums">
                        {fmtUSD(g.value)}
                      </span>
                    </li>
                  ))}
                  {accounts.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 self-center rounded-full"
                        style={{
                          background:
                            SERIES[a.type as keyof typeof SERIES] ?? "#8aa498",
                        }}
                        aria-hidden
                      />
                      <span className="text-prose">{a.name}</span>
                      <span className="text-xs text-faint">
                        {a.institution}
                        {a.apy != null ? ` · ${a.apy}% APY` : ""}
                      </span>
                      <span className="ml-auto text-subtle tabular-nums">
                        {accountValue(a) != null ? fmtUSD(accountValue(a)!) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {(pay.paychecks.length > 0 || dailySpending.length > 0) && (
            <Card title="Cash flow" delay={290}>
              <CashFlowViews periods={flowPeriods} days={dailySpending} today={today} />
            </Card>
          )}

          <Card title="Net worth projection" delay={300}>
            <ProjectionCard
              accounts={accounts.map((a) => ({
                type: a.type,
                last_balance: a.last_balance,
                apy: a.apy,
              }))}
              cds={cds.map((cd) => ({
                principal: cd.principal,
                apy: cd.apy,
                open_date: cd.open_date,
                maturity_date: cd.maturity_date,
              }))}
              income={income.map((i) => ({
                source_name: i.source_name,
                amount: i.amount,
                frequency: i.frequency,
              }))}
              currentBrokerage={snapshot.total_brokerage}
              hidden={[...hidden]}
            />
          </Card>

          {access && (
            <Card title="Accessible vs. locked" delay={310}>
              <AccessTimeline {...access} today={today} />
            </Card>
          )}
        </>
      )}

      {byTicker.size > 0 && (
        <>
          <SectionHeader
            title="Holdings"
            subtitle={`${byTicker.size} positions · ${fmtUSD(
              [...byTicker.values()].reduce((sum, h) => sum + h.value, 0)
            )}`}
          />
          <Card title="Holdings map" delay={320}>
            <HoldingsTreemap items={[...byTicker.values()]} />
          </Card>
          <Card title="Concentration" delay={330}>
            <Concentration
              items={[...byTicker.values()].map((h) => ({
                ...h,
                industry: industries.get(h.ticker) ?? null,
              }))}
            />
          </Card>
        </>
      )}

      {showSpending && (
        <SectionHeader
          title="Spending"
          subtitle={
            cards.length > 0 || bills.length > 0
              ? `${fmtUSD(thisMonthSpend)} this month`
              : undefined
          }
        />
      )}

      {(cards.length > 0 || bills.length > 0) && (
        <Card title="Spending" delay={340}>
          <SpendingRangeSection
            cards={cards.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer }))}
            bills={bills.map((b) => ({ id: b.id, name: b.name }))}
            budgets={budgets}
            today={today}
          />
          {(cardBenefits.length > 0 || cardCredits.count > 0) && (
            <div className="mt-6 border-t border-line pt-5">
              <CardCreditMeters
                cards={cards}
                benefits={cardBenefits}
                progress={benefitProgress}
                year={thisMonth.slice(0, 4)}
                untagged={untaggedCredits}
              />
            </div>
          )}
          <p className="mt-4 text-xs text-faint">
            Spending is tracked separately from net worth — it&apos;s a cash-flow
            view, not a balance-sheet liability. Amounts known only per month
            (manual card totals, bills) are spread evenly over their month.
          </p>
        </Card>
      )}

      {(runwayMonths != null || priorMonths.length > 0) && (
        <Card title="Cash flow &amp; insights" delay={345}>
          <div className="grid gap-6 md:grid-cols-[240px_1fr]">
            <div className="flex flex-col gap-3">
              {runwayMonths != null && (
                <div className="rounded-lg border border-line bg-canvas/40 p-4">
                  <p className="text-xs text-faint">Emergency-fund runway</p>
                  <p className="mt-1 text-3xl text-prose tabular-nums">
                    {runwayMonths.toFixed(1)}
                    <span className="ml-1 text-base text-faint">months</span>
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    {fmtUSD(cashOnHand)} cash ÷ {fmtUSD(avgMonthlySpend)}/mo avg spend
                  </p>
                </div>
              )}
              {savingsRate != null && (
                <div className="rounded-lg border border-line bg-canvas/40 p-4">
                  <p className="text-xs text-faint">Savings rate</p>
                  <p
                    className="mt-1 text-3xl tabular-nums"
                    style={{ color: savingsRate >= 0 ? DELTA_UP : DELTA_DOWN }}
                  >
                    {savingsRate.toFixed(0)}
                    <span className="ml-0.5 text-base">%</span>
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    {`${fmtUSD(monthlyTakeHome)} take-home − ${fmtUSD(avgMonthlySpend)}/mo avg spend`}
                  </p>
                  <p className="mt-0.5 text-xs text-faint">
                    {savingsRate >= 0
                      ? `≈ ${fmtUSD(monthlyTakeHome - avgMonthlySpend)}/mo kept`
                      : `≈ ${fmtUSD(avgMonthlySpend - monthlyTakeHome)}/mo short`}
                  </p>
                </div>
              )}
            </div>
            <ul className="flex flex-col justify-center gap-2.5 text-sm">
              {avgMonthlySpend > 0 && (
                <li className="flex items-baseline gap-2">
                  <span className="text-subtle">Average monthly spend</span>
                  <span className="ml-auto text-prose tabular-nums">
                    {fmtUSD(avgMonthlySpend)}
                  </span>
                </li>
              )}
              {thisVsAvgPct != null && (
                <li className="flex items-baseline gap-2">
                  <span className="text-subtle">This month vs. average</span>
                  <span
                    className="ml-auto tabular-nums"
                    style={{ color: thisVsAvgPct <= 0 ? DELTA_UP : DELTA_DOWN }}
                  >
                    {fmtPct(thisVsAvgPct, 0)} ({fmtUSD(thisMonthSpend)})
                  </span>
                </li>
              )}
              {highestMonth && (
                <li className="flex items-baseline gap-2">
                  <span className="text-subtle">Highest month</span>
                  <span className="ml-auto text-subtle tabular-nums">
                    {fmtUSD(highestMonth.total)} · {monthName(highestMonth.month)}
                  </span>
                </li>
              )}
              {topCategory && (
                <li className="flex items-baseline gap-2">
                  <span className="text-subtle">Top category this month</span>
                  <span className="ml-auto text-subtle tabular-nums">
                    {topCategory.category} · {fmtUSD(topCategory.total)}
                  </span>
                </li>
              )}
            </ul>
          </div>
        </Card>
      )}

      {!hidden.has("cds") && cds.length > 0 && (
        <SectionHeader
          title="CDs"
          subtitle={`${cds.length} ${cds.length === 1 ? "CD" : "CDs"} · ${fmtUSD(
            cds.reduce((s, cd) => s + cdCurrentValue(cd, now), 0)
          )}`}
        />
      )}

      {!hidden.has("cds") && cds.length > 0 && (
        <Card title="Certificates of deposit" delay={420}>
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
                {cds.map((cd) => {
                  const days = Math.ceil(
                    (new Date(cd.maturity_date + "T00:00:00").getTime() - now.getTime()) /
                      86_400_000
                  );
                  const profit = cdMaturityValue(cd) - cd.principal;
                  return (
                    <tr
                      key={cd.id}
                      className="border-t border-line transition-colors hover:bg-lift/40"
                    >
                      <td className="py-2 text-prose">{cd.bank_name}</td>
                      <td className="py-2 text-right text-subtle">
                        {fmtUSD(cd.principal)}
                      </td>
                      <td className="py-2 text-right text-subtle">
                        {cd.apy.toFixed(2)}%
                      </td>
                      <td className="py-2 text-right text-prose">
                        {fmtUSD(cdCurrentValue(cd, now))}
                      </td>
                      <td className="py-2 text-right text-prose">
                        {fmtUSD(cdMaturityValue(cd))}
                      </td>
                      <td className="py-2 text-right" style={{ color: DELTA_UP }}>
                        +{fmtUSD(profit)}
                      </td>
                      <td className="py-2 text-right text-subtle">
                        {fmtDate(cd.maturity_date)}
                        <span className="ml-1.5 text-xs text-faint">
                          {days > 0 ? `in ${days}d` : "matured"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!hidden.has("cds") && cds.length > 0 && (
        <Card title="CD ladder" delay={430}>
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

      {!hidden.has("cds") && cds.length > 0 && (
        <Card title="Interest earned" delay={440}>
          <CdInterestChart
            todayMs={now.getTime()}
            cds={cds.map((cd) => ({
              label: cd.bank_name,
              principal: cd.principal,
              apy: cd.apy,
              open: cd.open_date,
              maturity: cd.maturity_date,
            }))}
          />
        </Card>
      )}

      {pay.paychecks.length > 0 && (
        <>
          <SectionHeader
            title="Income"
            subtitle={`${fmtUSD(pay.ytdNet)} take-home in ${pay.year}`}
          />
          <Card delay={480}>
            <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <IncomeStat
                label="Gross YTD"
                value={fmtUSD(pay.ytdGross)}
                sub={pay.paceGross != null ? `on pace for ${fmtUSD(pay.paceGross, 0)}` : undefined}
              />
              <IncomeStat
                label="Take-home YTD"
                value={fmtUSD(pay.ytdNet)}
                sub={pay.avgMonthlyNet != null ? `${fmtUSD(pay.avgMonthlyNet, 0)} avg / month` : undefined}
              />
              <IncomeStat
                label="Tax withheld YTD"
                value={fmtUSD(pay.ytdTax)}
                sub={pay.effectiveRate != null ? `${(pay.effectiveRate * 100).toFixed(1)}% of gross` : undefined}
              />
              {pay.last && (
                <IncomeStat
                  label="Last paycheck"
                  value={fmtUSD(pay.last.net)}
                  sub={`${fmtDate(pay.last.date)} · ${fmtUSD(pay.last.tax)} tax`}
                />
              )}
            </dl>
            <IncomeChart
              paychecks={pay.paychecks}
              months={cashFlowShown}
              currentMonth={thisMonth}
            />
          </Card>
        </>
      )}

      {incomeStreams.length > 0 && (
        <Card
          title="Income streams"
          delay={480}
          action={
            <span className="text-xs text-faint">
              ≈ {fmtUSD(recurringMonthly)}/mo recurring
            </span>
          }
        >
          <ul className="flex flex-col gap-2.5 text-sm">
            {incomeStreams.map((i) => (
              <li key={i.id} className="flex items-baseline gap-2">
                <span className="text-prose">{i.source_name}</span>
                <span className="text-xs text-faint">
                  {i.frequency.replace("_", "-")}
                  {i.date_received ? ` · ${fmtDate(i.date_received)}` : ""}
                </span>
                <span className="ml-auto text-subtle tabular-nums">
                  {fmtUSD(i.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ChatPanel />
    </div>
  );
}
