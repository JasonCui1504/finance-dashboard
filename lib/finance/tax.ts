// Withholding maths, shared by the dashboard (server) and the Manage income
// tab (client). No server-only dependencies, so it can run in the browser.

export type Frequency = "paycheck" | "one_off" | "weekly" | "biweekly" | "monthly" | "irregular";

/** The fields the summary needs; both the server and client row types satisfy it. */
export type TaxableIncome = {
  amount: number;
  frequency: string;
  tax_withheld: number | null;
};

/** Periods per month for a recurring frequency; null for one-off/irregular. */
export function monthlyFactor(frequency: string): number | null {
  switch (frequency) {
    case "weekly":
      return 52 / 12;
    case "biweekly":
      return 26 / 12;
    case "monthly":
      return 1;
    default:
      return null;
  }
}

export type TaxSummary = {
  /** Monthly figures from recurring streams only — one-offs can't be annualized. */
  monthlyNet: number;
  monthlyTax: number;
  monthlyGross: number;
  /** Withheld ÷ gross, or null when nothing recurring has tax recorded. */
  effectiveRate: number | null;
  /** Recurring streams with no tax figure entered yet. */
  missingTax: number;
  /** One-off and irregular entries, at face value, outside the rate. */
  oneOffNet: number;
  oneOffTax: number;
  oneOffCount: number;
};

/**
 * `amount` is take-home, so gross is amount + tax withheld. Recurring streams
 * are normalized to a month; one-off and irregular income is reported on its
 * own, because a lump sum and a monthly rate aren't comparable.
 */
export function summarizeTax(streams: TaxableIncome[]): TaxSummary {
  let monthlyNet = 0;
  let monthlyTax = 0;
  let missingTax = 0;
  let oneOffNet = 0;
  let oneOffTax = 0;
  let oneOffCount = 0;

  for (const s of streams) {
    // Logged paychecks are pay history, summarized by summarizePaychecks.
    if (s.frequency === "paycheck") continue;
    const f = monthlyFactor(s.frequency);
    if (f == null) {
      oneOffNet += s.amount;
      oneOffTax += s.tax_withheld ?? 0;
      oneOffCount++;
      continue;
    }
    monthlyNet += s.amount * f;
    if (s.tax_withheld == null) missingTax++;
    else monthlyTax += s.tax_withheld * f;
  }

  const monthlyGross = monthlyNet + monthlyTax;
  return {
    monthlyNet,
    monthlyTax,
    monthlyGross,
    effectiveRate:
      monthlyGross > 0 && monthlyTax > 0 ? monthlyTax / monthlyGross : null,
    missingTax,
    oneOffNet,
    oneOffTax,
    oneOffCount,
  };
}
