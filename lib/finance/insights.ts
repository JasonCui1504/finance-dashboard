import type { ChatMessage } from "./llm";

// Aggregate figures the dashboard hands to the local model. Deliberately no
// account names, institutions or individual transactions — just totals the
// dashboard already shows. All derived figures (percentages, runway, deltas)
// are computed here rather than by the model, which is unreliable at math.
export type InsightFacts = {
  asOf: string;
  netWorth: {
    total: number;
    byCategory: Record<string, number>;
    change30dPct: number | null;
    change1yPct: number | null;
  };
  cash: { bankCash: number; runwayMonths: number | null };
  spending: {
    avgMonthly: number;
    thisMonthSoFar: number;
    dayOfMonth: number;
    daysInMonth: number;
    thisVsAvgPct: number | null;
    recentMonths: { month: string; total: number }[];
    topCategoriesThisMonth: { category: string; spent: number; budget: number | null }[];
    overBudget: { category: string; spent: number; budget: number }[];
  };
  income: {
    monthlyTakeHome: number | null;
    savingsRatePct: number | null;
    ytdGross: number | null;
    ytdNet: number | null;
    effectiveTaxRatePct: number | null;
  };
  cds: {
    count: number;
    lockedValue: number;
    maturingWithin90Days: { date: string; maturityValue: number; apy: number }[];
  };
  holdings: {
    positions: number;
    topPositions: { ticker: string; pctOfHoldings: number }[];
  };
};

const MAX_FACTS_BYTES = 16_000;

/** Loose shape check so arbitrary JSON can't be smuggled into the prompt. */
export function parseFacts(raw: unknown): InsightFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<InsightFacts>;
  if (
    typeof f.asOf !== "string" ||
    !f.netWorth ||
    !f.cash ||
    !f.spending ||
    !f.income ||
    !f.cds ||
    !f.holdings
  ) {
    return null;
  }
  if (JSON.stringify(raw).length > MAX_FACTS_BYTES) return null;
  return f as InsightFacts;
}

const SYSTEM_PROMPT = `You are a careful personal-finance analyst reviewing one person's dashboard.
You are given a JSON summary of their finances. Rules:
- Use ONLY the figures in the JSON. Never invent numbers, accounts or events.
- Prefer figures that are already computed (percentages, runway, deltas) over doing your own math.
- Write 4 to 6 insights as a markdown bullet list ("- " per line), most important first.
- Each bullet is one or two short sentences and cites a concrete number from the data.
- Focus on what is notable: risks (short cash runway, over budget, spending above average, concentration in one position), CDs about to mature that need a decision, savings rate, and trends in net worth.
- spending.thisMonthSoFar covers only dayOfMonth of daysInMonth days; account for that before calling the month high or low.
- Null means unknown; skip it rather than guessing.
- No preamble, no closing summary, no disclaimers, and do not recommend specific securities.`;

export function buildInsightMessages(facts: InsightFacts): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Dashboard summary as of ${facts.asOf} (USD):\n${JSON.stringify(facts, null, 1)}`,
    },
  ];
}
