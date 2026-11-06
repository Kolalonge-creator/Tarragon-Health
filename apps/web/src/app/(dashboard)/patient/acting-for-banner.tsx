import { closeTheirAccount } from "./supporting/actions";
import type { ActingFor } from "@/lib/acting/acting-for";

/**
 * Whose account is open, stated plainly and impossible to scroll past.
 *
 * This is the safety half of letting one person act for another. Everything a
 * supporter records here is stamped with their own name for the patient and
 * the care team to see, but the person doing it also has to be certain, at a
 * glance, that they are not looking at their own record. A misattributed blood
 * pressure is not a cosmetic problem: the red-flag engines read it as this
 * patient's own account of themselves.
 */
export function ActingForBanner({ acting }: { acting: ActingFor | null }) {
  if (!acting) return null;
  const name = acting.fullName ?? "the person you support";

  return (
    <div
      role="region"
      aria-label="Whose account is open"
      data-testid="acting-for-banner"
      // Sticky just under the shell's sticky header (about 61px tall) so it can
      // never be scrolled out of view. Real amber values: the old
      // `clinical-amber` token was never defined, so the banner had no colour.
      className="sticky top-[61px] z-30 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 shadow-sm print:static dark:border-amber-300/50 dark:bg-amber-950"
    >
      <div>
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          You are in {name}&apos;s account, not your own.
        </p>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Anything you record here is saved in their name with yours next to it, so they and their
          care team can see you did it.
        </p>
      </div>
      <form action={closeTheirAccount}>
        <button
          type="submit"
          className="rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card px-3 py-1.5 text-sm font-medium text-charcoal-ink dark:text-night-ink"
        >
          Back to my account
        </button>
      </form>
    </div>
  );
}
