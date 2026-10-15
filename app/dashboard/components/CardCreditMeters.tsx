import { fmtUSD } from "./format";

type Card = { id: number; name: string };
type Benefit = {
  id: number;
  card_id: number;
  name: string;
  amount: number;
  period: "annual" | "monthly";
};
type Progress = { benefit_id: number; used: number; months_used: number };

// Meter states. The fill carries severity and every state also ships a word,
// so the reading never depends on colour alone.
const DONE = "#199e70";
const OPEN = "#4a7c59";
const AT_RISK = "#c98500";
const LATE = "#e66767";
const TRACK = "#243028";
const MUTED = "#8aa498";
const PIE = 60;

/** A small filled pie: the used share as a wedge from 12 o'clock over a track. */
function CreditPie({ pct, fill, label }: { pct: number; fill: string; label: string }) {
  const c = PIE / 2;
  const r = c - 2;
  const a = -Math.PI / 2 + pct * Math.PI * 2;
  const x = c + r * Math.cos(a);
  const y = c + r * Math.sin(a);
  return (
    <svg viewBox={`0 0 ${PIE} ${PIE}`} className="h-[60px] w-[60px]" role="img" aria-label={label}>
      <circle cx={c} cy={c} r={r} fill={TRACK} />
      {pct >= 0.999 ? (
        <circle cx={c} cy={c} r={r} fill={fill} />
      ) : pct > 0 ? (
        <path
          d={`M${c},${c}L${c},${c - r}A${r},${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${x.toFixed(2)},${y.toFixed(2)}Z`}
          fill={fill}
        />
      ) : null}
      <text
        x={c}
        y={c + 4}
        textAnchor="middle"
        fontSize="12"
        fill="#deeade"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function daysLeftInYear(year: string): number {
  const end = Date.UTC(Number(year) + 1, 0, 1);
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

export default function CardCreditMeters({
  cards,
  benefits,
  progress,
  year,
  untagged,
}: {
  cards: Card[];
  benefits: Benefit[];
  progress: Progress[];
  year: string;
  untagged: { total: number; count: number };
}) {
  const daysLeft = daysLeftInYear(year);
  const now = new Date();
  const monthsElapsed =
    String(now.getFullYear()) === year ? now.getMonth() + 1 : 12;
  const by = new Map(progress.map((p) => [p.benefit_id, p]));

  // An annual benefit's allowance is its full amount; a monthly one accrues,
  // so by October you could have redeemed ten of twelve.
  const rows = benefits.map((b) => {
    const p = by.get(b.id);
    const used = p?.used ?? 0;
    const allowance = b.period === "monthly" ? b.amount * monthsElapsed : b.amount;
    const pct = allowance > 0 ? Math.min(1, used / allowance) : 0;
    const left = Math.max(0, allowance - used);
    const complete = left < 0.01;
    // Unused money matters more as the window closes.
    const urgency = !complete && daysLeft <= 60 ? (daysLeft <= 30 ? "late" : "soon") : "open";
    return { b, used, allowance, pct, left, complete, urgency, p };
  });

  const totalAllowance = rows.reduce((s, r) => s + r.allowance, 0);
  const totalUsed = rows.reduce((s, r) => s + r.used, 0);
  const totalLeft = Math.max(0, totalAllowance - totalUsed);

  if (benefits.length === 0) {
    return (
      <p className="text-xs text-faint">
        No card benefits defined yet. Add them under Manage → Spending to track
        how much of each credit you&apos;ve used.
      </p>
    );
  }

  const byCard = cards
    .map((c) => ({ card: c, rows: rows.filter((r) => r.b.card_id === c.id) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-xs text-faint">Card credits · {year}</p>
        <p className="text-xl font-medium text-accent">{fmtUSD(totalUsed)}</p>
        <p className="text-xs text-faint">
          of {fmtUSD(totalAllowance)} ·{" "}
          {totalLeft > 0.01 ? (
            <span className={daysLeft <= 60 ? "text-[#c98500]" : undefined}>
              {fmtUSD(totalLeft)} still unused
            </span>
          ) : (
            "all credits used"
          )}{" "}
          · {daysLeft} days left in the year
        </p>
      </div>

      {byCard.map(({ card, rows: cardRows }) => {
        const used = cardRows.reduce((s, r) => s + r.used, 0);
        const allowance = cardRows.reduce((s, r) => s + r.allowance, 0);
        return (
          <div key={card.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="text-sm text-subtle">{card.name}</p>
              <p className="text-xs text-faint tabular-nums">
                {fmtUSD(used, 0)} of {fmtUSD(allowance, 0)} used
              </p>
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
              {cardRows.map((r) => {
                const fill = r.complete
                  ? DONE
                  : r.urgency === "late"
                    ? LATE
                    : r.urgency === "soon"
                      ? AT_RISK
                      : OPEN;
                const status = r.complete
                  ? "✓ used"
                  : r.b.period === "monthly"
                    ? `${r.p?.months_used ?? 0} of ${monthsElapsed} mo`
                    : `${fmtUSD(r.left, 0)} left${r.urgency !== "open" ? " ⚠" : ""}`;
                return (
                  <div key={r.b.id} className="flex flex-col items-center gap-1.5 text-center">
                    <CreditPie
                      pct={r.pct}
                      fill={fill}
                      label={`${r.b.name}: ${fmtUSD(r.used)} of ${fmtUSD(r.allowance)} used (${Math.round(r.pct * 100)}%), ${status}`}
                    />
                    <p className="text-xs leading-snug text-prose">{r.b.name}</p>
                    <p className="text-xs text-faint tabular-nums">
                      {fmtUSD(r.used, 0)} / {fmtUSD(r.allowance, 0)}
                      {r.b.period === "monthly" ? " so far" : ""}
                    </p>
                    <p className="text-xs" style={{ color: r.complete ? DONE : MUTED }}>
                      {status}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {untagged.count > 0 && (
        <p className="text-xs text-faint">
          {fmtUSD(untagged.total)} of credits ({untagged.count}) aren&apos;t
          assigned to a benefit yet — tag them under Manage → Spending to count
          them here.
        </p>
      )}
    </div>
  );
}
