/**
 * How stale the naira-to-dollar reference rate is allowed to get.
 *
 * Every dollar price on the platform is its naira price divided by one
 * admin-set number (see private.enforce_derived_price and the one-price-list
 * decision of 20260729). That number is deliberately not a live market feed:
 * a price only moves when a person moves it, so nobody wakes up to a plan that
 * silently repriced overnight.
 *
 * The cost of that choice is that a rate nobody looks at is a one-directional
 * leak. If the naira weakens and the rate is left alone, dollar buyers quietly
 * pay less in real terms every month. If it strengthens, they quietly pay more
 * than a naira buyer for the same thing, which is the exact scepticism the one
 * price list exists to prevent. Neither shows up anywhere until someone thinks
 * to check, and before this there was nothing at all prompting anyone to.
 *
 * So the rate carries a review clock. Reviewing is not the same as changing:
 * confirming the number is still right is a valid, recorded outcome, and the
 * common one.
 */
export const FX_REVIEW_INTERVAL_DAYS = 30;

/** Past this it stops being a nudge and starts being a real pricing risk. */
export const FX_REVIEW_OVERDUE_DAYS = 90;

export type FxReviewStatus = "never" | "current" | "due" | "overdue";

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between `iso` and `now`, or null when there is no timestamp.
 *
 * Floors rather than rounds, so "0 days" means today and a review can never
 * read as older than it is.
 */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY));
}

export function fxReviewStatus(days: number | null): FxReviewStatus {
  if (days === null) return "never";
  if (days >= FX_REVIEW_OVERDUE_DAYS) return "overdue";
  if (days >= FX_REVIEW_INTERVAL_DAYS) return "due";
  return "current";
}

/** Plain-language line for the admin screen. Never alarming, always specific. */
export function fxReviewMessage(days: number | null): string {
  switch (fxReviewStatus(days)) {
    case "never":
      return "This rate has never been reviewed by a person. It was set by a migration when the single price list was introduced.";
    case "overdue":
      return `Last reviewed ${days} days ago. Every dollar price on the platform has been converted at this number for over three months without anyone confirming it still holds.`;
    case "due":
      return `Last reviewed ${days} days ago. Worth a look: confirming it is still right takes one click and changes no price.`;
    case "current":
      return days === 0
        ? "Reviewed today."
        : `Reviewed ${days} day${days === 1 ? "" : "s"} ago.`;
  }
}
