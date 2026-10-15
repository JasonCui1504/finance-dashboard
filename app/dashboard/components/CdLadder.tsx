import { fmtDate, fmtUSD, SERIES } from "./format";

type Cd = {
  id: number;
  bank_name: string;
  principal: number;
  apy: number;
  open_date: string;
  maturity_date: string;
};

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const DAY_MS = 86_400_000;

function maturityValue(cd: Cd): number {
  const years =
    (new Date(cd.maturity_date + "T00:00:00Z").getTime() -
      new Date(cd.open_date + "T00:00:00Z").getTime()) /
    YEAR_MS;
  return cd.principal * Math.pow(1 + cd.apy / 100, Math.max(0, years));
}

/**
 * One progress bar per CD showing how far it is through its OWN term
 * (open date → maturity date), so CDs with different start/end dates read on
 * their own timelines rather than a shared calendar axis.
 */
export default function CdLadder({ cds, nowMs }: { cds: Cd[]; nowMs: number }) {
  if (cds.length === 0) {
    return <p className="text-sm text-faint">No CDs to ladder yet.</p>;
  }

  const sorted = [...cds].sort(
    (a, b) =>
      new Date(a.maturity_date).getTime() - new Date(b.maturity_date).getTime()
  );
  const totalAtMaturity = sorted.reduce((sum, c) => sum + maturityValue(c), 0);

  return (
    <div>
      <p className="mb-4 text-sm text-faint">
        {cds.length} CDs ·{" "}
        <span className="text-subtle">{fmtUSD(totalAtMaturity)}</span> total at
        maturity
      </p>

      <div className="flex flex-col gap-4">
        {sorted.map((cd) => {
          const open = new Date(cd.open_date + "T00:00:00Z").getTime();
          const mat = new Date(cd.maturity_date + "T00:00:00Z").getTime();
          const term = Math.max(1, mat - open);
          const progress = Math.max(0, Math.min(1, (nowMs - open) / term));
          const daysLeft = Math.ceil((mat - nowMs) / DAY_MS);
          const matured = nowMs >= mat;
          const value = maturityValue(cd);
          return (
            <div key={cd.id}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-subtle">{cd.bank_name}</span>
                <span className="text-faint tabular-nums">
                  {cd.apy}% APY · {fmtUSD(cd.principal)} → {fmtUSD(value)}
                </span>
              </div>
              <div
                className="relative h-2.5 overflow-hidden rounded-full bg-canvas"
                role="img"
                aria-label={`${cd.bank_name}: ${matured ? "matured" : `${Math.round(
                  progress * 100
                )}% through its term, ${daysLeft} days to maturity`}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${progress * 100}%`,
                    background: matured ? "#199e70" : SERIES.cds,
                  }}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[11px] text-faint tabular-nums">
                <span>Opened {fmtDate(cd.open_date)}</span>
                <span className="text-subtle">
                  {matured
                    ? "matured"
                    : `${Math.round(progress * 100)}% · ${daysLeft}d left`}
                </span>
                <span>Matures {fmtDate(cd.maturity_date)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
