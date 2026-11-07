import Link from "next/link";
import { STATUS_CLASSES } from "@tarragon/ui/status";
import {
  ATTENTION_TIER_LABEL,
  countByTier,
  timeOutstanding,
  type AttentionTier,
  type ExecutiveAttentionItem,
} from "@tarragon/shared";
import { formatPatientDateTime } from "@/lib/format-date";

/** Only "critical" uses the critical (red) status colour; high is urgent, ordinary governance work is amber or grey. */
export const TIER_STATUS: Record<AttentionTier, keyof typeof STATUS_CLASSES> = {
  critical: "critical",
  high: "urgent",
  attention: "attention",
  routine: "inactive",
};

export function TierBadge({ tier }: { tier: AttentionTier }) {
  const c = STATUS_CLASSES[TIER_STATUS[tier]];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${c.tint} ${c.text}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {ATTENTION_TIER_LABEL[tier]}
    </span>
  );
}

const TIERS: AttentionTier[] = ["critical", "high", "attention", "routine"];

/**
 * "Requires executive attention": the ranked list the CMO reads first. Rows link to the record's own page, where the
 * approved workflow (claim, review, resolve, sign) happens; nothing is dismissed or closed from here.
 */
export function AttentionPanel({
  items,
  now,
  limit,
  incomplete,
  showAllHref,
}: {
  items: readonly ExecutiveAttentionItem[];
  now: Date;
  limit: number;
  /** Some sources could not be read: the list must not read as an all-clear. */
  incomplete: boolean;
  showAllHref: string | null;
}) {
  const counts = countByTier(items);
  const shown = items.slice(0, limit);
  return (
    <section aria-labelledby="exec-attention-heading" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal-ink/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="exec-attention-heading" className="font-heading text-lg font-semibold text-charcoal-ink">
            Requires executive attention
          </h2>
          <p className="text-sm text-charcoal-ink/65">
            Live. Ranked by clinical urgency and governance risk, then by how long each has been outstanding.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Items by priority">
          {TIERS.map((t) => (
            <li key={t} className="flex items-center gap-1.5 text-sm">
              <TierBadge tier={t} />
              <span className="tabular-nums font-semibold text-charcoal-ink">{counts[t]}</span>
            </li>
          ))}
        </ul>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-xl bg-warm-ivory p-4 text-sm text-charcoal-ink/75">
          {incomplete
            ? "Nothing to show from the sources that loaded. Part of this list could not be read, so this is not an all-clear."
            : "Nothing needs your attention right now: no critical, overdue or unassigned clinical work, no open incidents, safeguarding concerns or sign-offs."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Items requiring executive attention, most urgent first</caption>
            <thead className="border-b border-charcoal-ink/10 text-xs uppercase tracking-wide text-charcoal-ink/55">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Priority</th>
                <th scope="col" className="py-2 pr-3 font-medium">Issue</th>
                <th scope="col" className="py-2 pr-3 font-medium">Raised</th>
                <th scope="col" className="py-2 pr-3 font-medium">Owner</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-ink/5">
              {shown.map((item) => {
                const age = timeOutstanding(item.raisedAt, now);
                return (
                  <tr key={item.key} className="align-top">
                    <td className="py-3 pr-3"><TierBadge tier={item.tier} /></td>
                    <td className="py-3 pr-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">{item.kind}</div>
                      <div className="text-charcoal-ink">{item.title}</div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-charcoal-ink/75">
                      {item.raisedAt ? formatPatientDateTime(item.raisedAt) : "Not dated"}
                      {age && <div className="text-xs text-charcoal-ink/55">{age} outstanding</div>}
                    </td>
                    <td className="py-3 pr-3 text-charcoal-ink/80">{item.owner ?? <span className="font-medium">No owner</span>}</td>
                    <td className="py-3 pr-3 text-charcoal-ink/80">{item.status}</td>
                    <td className="py-3">
                      <Link href={item.href} className="font-medium text-brand-green underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-green">
                        {item.nextAction}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length > shown.length && showAllHref && (
        <p className="mt-3 text-sm text-charcoal-ink/70">
          Showing {shown.length} of {items.length}.{" "}
          <Link href={showAllHref} className="font-medium text-brand-green underline">Show all</Link>
        </p>
      )}
    </section>
  );
}
