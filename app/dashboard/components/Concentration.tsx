import { fmtUSD } from "./format";

type Item = { ticker: string; value: number; industry: string | null };

const BAR = "#3987e5"; // brokerage blue: one hue, magnitude only
const TRACK = "#243028";
const REST = "#4a5a52";

/**
 * How top-heavy the portfolio is, and what it's made of: top-N shares with
 * the "effective number" of equal-sized positions, the top ten as one bar,
 * and value by industry (ETFs and funds grouped, unlooked-up tickers marked).
 */
export default function Concentration({ items }: { items: Item[] }) {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return null;

  const share = (n: number) => sorted.slice(0, n).reduce((s, i) => s + i.value, 0) / total;
  // 1 / Σw²: how many equal positions would give the same concentration.
  const effective = 1 / sorted.reduce((s, i) => s + (i.value / total) ** 2, 0);
  const top10 = sorted.slice(0, 10);
  const restValue = total - top10.reduce((s, i) => s + i.value, 0);

  const byIndustry = new Map<string, number>();
  for (const i of sorted) {
    const label =
      i.industry == null
        ? "Not looked up yet"
        : i.industry === "N/A"
          ? "Unclassified"
          : i.industry || "ETFs & funds";
    byIndustry.set(label, (byIndustry.get(label) ?? 0) + i.value);
  }
  const ranked = [...byIndustry.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  // Top eight, then the long tail as one row.
  const industries =
    ranked.length > 9
      ? [
          ...ranked.slice(0, 8),
          {
            label: `Other (${ranked.length - 8} industries)`,
            value: ranked.slice(8).reduce((s, r) => s + r.value, 0),
          },
        ]
      : ranked;
  const maxIndustry = industries[0]?.value ?? 1;
  const pending = byIndustry.has("Not looked up yet");

  const stats = [
    { label: "Largest position", value: `${(share(1) * 100).toFixed(1)}%`, sub: sorted[0].ticker },
    { label: "Top 5", value: `${(share(5) * 100).toFixed(1)}%`, sub: "of holdings" },
    { label: "Top 10", value: `${(share(10) * 100).toFixed(1)}%`, sub: "of holdings" },
    {
      label: "Effective positions",
      value: effective.toFixed(1),
      sub: `of ${sorted.length} held`,
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg bg-canvas/40 p-3">
              <dt className="text-xs text-faint">{s.label}</dt>
              <dd className="mt-1 text-lg text-prose tabular-nums">{s.value}</dd>
              <dd className="text-xs text-faint">{s.sub}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-faint">Top 10 positions, then everything else</p>
          <div
            className="flex h-3 w-full overflow-hidden rounded-sm"
            role="img"
            aria-label={`Top 10 positions are ${(share(10) * 100).toFixed(0)}% of holdings`}
          >
            {top10.map((i, k) => (
              <div
                key={i.ticker}
                title={`${i.ticker}: ${fmtUSD(i.value)} (${((i.value / total) * 100).toFixed(1)}%)`}
                style={{
                  width: `${(i.value / total) * 100}%`,
                  background: BAR,
                  opacity: 1 - k * 0.06,
                  marginLeft: k ? 2 : 0,
                }}
              />
            ))}
            {restValue > 0 && (
              <div style={{ width: `${(restValue / total) * 100}%`, background: REST, marginLeft: 2 }} />
            )}
          </div>
          <p className="text-xs text-faint">
            {top10.map((i) => i.ticker).join(" · ")}
            {sorted.length > 10 ? ` · then ${sorted.length - 10} more` : ""}
          </p>
          <p className="text-xs text-faint">
            &ldquo;Effective positions&rdquo; is how many equal-sized holdings would be
            this concentrated.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-faint">By industry</p>
        <ul className="flex flex-col gap-2 text-sm">
          {industries.map((ind) => (
            <li key={ind.label} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-subtle">{ind.label}</span>
                <span className="ml-auto text-prose tabular-nums">{fmtUSD(ind.value, 0)}</span>
                <span className="w-12 text-right text-xs text-faint tabular-nums">
                  {((ind.value / total) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-sm" style={{ background: TRACK }}>
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${(ind.value / maxIndustry) * 100}%`, background: BAR }}
                />
              </div>
            </li>
          ))}
        </ul>
        {pending && (
          <p className="text-xs text-faint">
            Industries are looked up once per ticker during the daily refresh.
          </p>
        )}
      </div>
    </div>
  );
}
