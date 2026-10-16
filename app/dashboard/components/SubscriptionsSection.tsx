import { listSubscriptions } from "../../../lib/finance/resort";
import { fmtDate, fmtUSD } from "./format";

/**
 * Monthly charges found in the imported statements: what each costs, and
 * which are new or changed price. Renders nothing until one is found.
 */
export default async function SubscriptionsSection({
  cards,
  delay = 0,
}: {
  cards: { id: number; name: string }[];
  delay?: number;
}) {
  const subs = await listSubscriptions();
  if (subs.length === 0) return null;
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const monthly = subs.reduce((s, x) => s + x.amount, 0);

  return (
    <section
      className="fin-card fin-rise rounded-xl border border-line bg-surface p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-subtle">Subscriptions</h2>
        <p className="text-sm tabular-nums text-prose">
          {fmtUSD(monthly)}
          <span className="text-xs text-faint">/mo · {fmtUSD(monthly * 12, 0)}/yr</span>
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {subs.map((s) => (
          <li key={`${s.key}-${s.since}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-subtle">{s.name}</span>
            <span className="text-xs text-faint">{cardName.get(s.card_id) ?? ""}</span>
            {s.is_new && (
              <span className="rounded bg-lift px-1.5 py-0.5 text-[11px] text-prose" title={`First charged ${fmtDate(s.since)}`}>
                new since {fmtDate(s.since).replace(/, \d{4}$/, "")}
              </span>
            )}
            {s.previous_amount != null && (
              <span className="rounded bg-lift px-1.5 py-0.5 text-[11px] text-[#e66767]">
                was {fmtUSD(s.previous_amount)}
              </span>
            )}
            <span className="ml-auto tabular-nums text-prose">{fmtUSD(s.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-faint">
        Found automatically: the same merchant charging about the same amount about monthly, at
        least three times. Not a subscription? Recategorize one of its charges under Manage →
        Spending.
      </p>
    </section>
  );
}
