import { getSpendingActivity } from "../../../lib/finance/queries";
import { getTaxonomy, listSpendingBudgets } from "../../../lib/finance/taxonomy";
import SpendingRange from "./SpendingRange";

/**
 * Server half of the spending card: loads the per-day activity, labels and
 * budgets itself, so the dashboard page only passes what it already has.
 */
export default async function SpendingRangeSection({
  cards,
  bills,
  today,
}: {
  cards: { id: number; name: string; issuer: string }[];
  bills: { id: number; name: string }[];
  today: string;
}) {
  const [{ days, merchants, monthly }, taxonomy, budgets] = await Promise.all([
    getSpendingActivity(),
    getTaxonomy(),
    listSpendingBudgets(),
  ]);
  return (
    <SpendingRange
      cards={cards}
      bills={bills}
      days={days}
      merchants={merchants}
      monthly={monthly}
      taxonomy={taxonomy}
      budgets={budgets}
      today={today}
    />
  );
}
