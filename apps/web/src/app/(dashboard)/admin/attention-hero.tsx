import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/ui/load-failure";
import type { AttentionKey, AttentionView } from "@tarragon/shared";

const UNKNOWN_LABEL: Record<AttentionKey, string> = {
  serious_incidents: "serious incidents",
  ai_governance: "AI governance sign-off",
  front_desk_signoff: "front desk sign-off",
  clinician_verification: "clinician verifications",
  booking_requests: "booking requests",
};

/**
 * The first thing on the admin home: what needs this person, most urgent first, with one button. The ranking is
 * attentionView in @tarragon/shared. A list that is missing items because a read failed says so; it is never the "caught up" state.
 */
export function AttentionHero({ view }: { view: AttentionView }) {
  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        What needs you could not be loaded ({view.unknown.map((u) => UNKNOWN_LABEL[u.key]).join(", ")}). This is not an all-clear: open each
        queue directly to check.
      </LoadFailure>
    );
  }

  if (view.kind === "clear") {
    return (
      <section aria-label="Needs you" className="rounded-2xl bg-white p-5 dark:bg-night-card sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Needs you</p>
        <p className="mt-2 font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink">Nothing is waiting on you</p>
        <p className="mt-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">Every queue you can see was checked and is empty.</p>
      </section>
    );
  }

  const { top, rest, unknown } = view;
  return (
    <section aria-label="Needs you" className="space-y-4 rounded-2xl bg-white p-5 dark:bg-night-card sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Needs you first</p>
      <p className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">{top.text}</p>
      <Button asChild size="lg">
        <Link href={top.href}>Open it</Link>
      </Button>
      {rest.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10 border-t border-charcoal-ink/10 dark:divide-night-ink/15 dark:border-night-ink/15">
          {rest.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-charcoal-ink hover:text-deep-forest dark:text-night-ink"
              >
                <span>{r.text}</span>
                <span aria-hidden>→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && (
        <p role="status" className="text-sm font-medium text-amber-700 dark:text-amber-300">
          This list is incomplete: {unknown.map((u) => UNKNOWN_LABEL[u.key]).join(", ")} could not be loaded.
        </p>
      )}
    </section>
  );
}
