import { fmtUSD } from "./format";

type CategorySpend = { category: string; total: number };
type Budget = { category: string; monthly_limit: number };

const SPEND = "#d55181"; // magenta — matches the spending chart
const OVER = "#e66767";
const GOOD = "#199e70";

/**
 * Spend by category for the period on screen as sorted bars, with budget
 * progress where a category has a limit set (already scaled to the period).
 */
export default function CategoryBreakdown({
  spend,
  budgets,
  trend,
  trendLabel = "vs this category's average over the 3 months before",
}: {
  spend: CategorySpend[];
  budgets: Budget[];
  /** Percent change vs the category's recent average; absent when there isn't one. */
  trend?: Map<string, number>;
  /** Tooltip explaining what the trend percentage compares against. */
  trendLabel?: string;
}) {
  if (spend.length === 0) {
    return (
      <p className="text-sm text-faint">
        No categorized transactions in this period. Import a statement under
        Manage → Spending to see your category breakdown.
      </p>
    );
  }

  const budgetFor = new Map(budgets.map((b) => [b.category, b.monthly_limit]));
  const max = Math.max(...spend.map((s) => s.total), 1);

  return (
    <ul className="flex flex-col gap-3">
      {spend.map((s) => {
        const limit = budgetFor.get(s.category);
        const hasBudget = limit != null && limit > 0;
        const overBudget = hasBudget && s.total > limit;
        // Bar width: against the budget if set, otherwise against the top category.
        const denom = hasBudget ? limit : max;
        // A category whose returns outweigh its purchases nets negative: no bar.
        const width = Math.max(0, Math.min(100, (s.total / denom) * 100));
        return (
          <li key={s.category}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-subtle">{s.category}</span>
                {(() => {
                  const t = trend?.get(s.category);
                  if (t == null) return null;
                  // Spending more than usual is the notable direction, so it
                  // gets the warm colour; the sign carries the meaning either way.
                  return (
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: t > 0 ? OVER : GOOD }}
                      title={trendLabel}
                    >
                      {t > 0 ? "+" : ""}
                      {t.toFixed(0)}%
                    </span>
                  );
                })()}
              </span>
              <span className="tabular-nums text-prose">
                {fmtUSD(s.total)}
                {hasBudget && (
                  <span
                    className="ml-1.5 text-xs"
                    style={{ color: overBudget ? OVER : "#8aa498" }}
                  >
                    / {fmtUSD(limit)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${width}%`,
                  background: overBudget ? OVER : hasBudget ? GOOD : SPEND,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
