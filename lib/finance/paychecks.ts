// Pay history from logged paychecks (frequency "paycheck"). Each entry is one
// real paycheck: `amount` is take-home and gross is take-home + tax withheld.
// No server-only dependencies, so it can run in the browser.

export type PaycheckEntry = {
  amount: number;
  frequency: string;
  date_received: string | null;
  tax_withheld: number | null;
};

export type Paycheck = {
  date: string;
  net: number;
  tax: number;
  gross: number;
};

export type PaycheckSummary = {
  year: string;
  /** This year's paychecks, oldest first. */
  paychecks: Paycheck[];
  ytdNet: number;
  ytdTax: number;
  ytdGross: number;
  /** Withheld ÷ gross for the year, or null with no tax recorded. */
  effectiveRate: number | null;
  last: Paycheck | null;
  /**
   * Year-end gross if pay continues at the usual size and cadence. Null until
   * there are enough paychecks to tell the cadence.
   */
  paceGross: number | null;
  /**
   * Average take-home per complete month (months before the current one, from
   * the first paycheck on). Null until a full month has passed.
   */
  avgMonthlyNet: number | null;
};

const DAY_MS = 86_400_000;

/**
 * Lower median: with an even count it takes the smaller middle value, so with
 * only two paychecks a bonus can't set the "typical" size.
 */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function dayMs(iso: string): number {
  return new Date(iso + "T00:00:00Z").getTime();
}

export function summarizePaychecks(
  entries: PaycheckEntry[],
  today: string
): PaycheckSummary {
  const year = today.slice(0, 4);
  const thisMonth = today.slice(0, 7);
  const paychecks = entries
    .filter(
      (e): e is PaycheckEntry & { date_received: string } =>
        e.frequency === "paycheck" && !!e.date_received?.startsWith(year)
    )
    .map((e) => {
      const tax = e.tax_withheld ?? 0;
      return { date: e.date_received, net: e.amount, tax, gross: e.amount + tax };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const ytdNet = paychecks.reduce((s, p) => s + p.net, 0);
  const ytdTax = paychecks.reduce((s, p) => s + p.tax, 0);
  const ytdGross = ytdNet + ytdTax;

  // Cadence from the median gap, size from the median gross, so a bonus
  // doesn't inflate the rest of the year.
  let paceGross: number | null = null;
  if (paychecks.length >= 2) {
    const gaps = paychecks
      .slice(1)
      .map((p, i) => (dayMs(p.date) - dayMs(paychecks[i].date)) / DAY_MS)
      .filter((g) => g > 0);
    if (gaps.length > 0) {
      const gap = median(gaps);
      const lastDay = dayMs(paychecks[paychecks.length - 1].date);
      const daysLeft = (dayMs(`${year}-12-31`) - lastDay) / DAY_MS;
      const remaining = Math.max(0, Math.floor(daysLeft / gap));
      paceGross = ytdGross + remaining * median(paychecks.map((p) => p.gross));
    }
  }

  let avgMonthlyNet: number | null = null;
  if (paychecks.length > 0) {
    const first = paychecks[0].date.slice(0, 7);
    const complete = paychecks.filter((p) => p.date.slice(0, 7) < thisMonth);
    if (first < thisMonth) {
      const [fy, fm] = first.split("-").map(Number);
      const [ty, tm] = thisMonth.split("-").map(Number);
      const months = (ty - fy) * 12 + (tm - fm);
      avgMonthlyNet = complete.reduce((s, p) => s + p.net, 0) / months;
    }
  }

  return {
    year,
    paychecks,
    ytdNet,
    ytdTax,
    ytdGross,
    effectiveRate: ytdGross > 0 && ytdTax > 0 ? ytdTax / ytdGross : null,
    last: paychecks[paychecks.length - 1] ?? null,
    paceGross,
    avgMonthlyNet,
  };
}
