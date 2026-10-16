import { getSpendingActivity } from "../../../lib/finance/queries";
import SpendingRange from "./SpendingRange";

/**
 * Server half of the spending card: loads the per-day activity itself, so
 * the dashboard page only passes what it already has.
 */
export default async function SpendingRangeSection({
  cards,
  bills,
  budgets,
  today,
}: {
  cards: { id: number; name: string; issuer: string }[];
  bills: { id: number; name: string }[];
  budgets: { category: string; monthly_limit: number }[];
  today: string;
}) {
  const { days, monthly } = await getSpendingActivity();
  return (
    <SpendingRange
      cards={cards}
      bills={bills}
      days={days}
      monthly={monthly}
      budgets={budgets}
      today={today}
    />
  );
}
