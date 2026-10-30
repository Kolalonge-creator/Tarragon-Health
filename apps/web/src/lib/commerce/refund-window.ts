import type { RefundPolicy } from "@/lib/commerce/refund-rule";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a refund can still be asked for, on the same boundary the database uses. public.request_order_refund refuses when
 * `now() > paid_at + make_interval(days => window)`, and refuses an order with no `paid_at`. So the last moment a request is accepted is
 * exactly `window` x 24 hours after payment (504 hours for the 21-day Membership window), and that very moment still counts.
 *
 * This only decides whether the screen offers the button. The database stays the authority and re-checks on the request. A paid_at that
 * cannot be read as a date leaves the button on, because the database will give the real answer; hiding it would be the worse mistake.
 */
export function refundWindowOpen(paidAt: string | null, windowDays: number, now: Date = new Date()): boolean {
  if (paidAt === null) return false;
  const paidMs = Date.parse(paidAt);
  if (Number.isNaN(paidMs)) return true;
  return now.getTime() <= paidMs + windowDays * DAY_MS;
}

/**
 * The window that applies to one order, from the active policy (never a number typed here). A Membership has its own window and every other
 * order uses the cooling-off window, exactly as the database picks between them. When the item is not in the catalogue the screen was given
 * (for example one that has since been retired), its kind is unknown, so the longer window is used: offering a button the database then
 * refuses costs one polite refusal, while hiding a button the database would honour takes away a right.
 */
export function refundWindowDaysFor(policy: RefundPolicy, kind: string | undefined): number {
  if (kind === "membership") return policy.membershipWindowDays;
  if (kind === undefined) return Math.max(policy.membershipWindowDays, policy.coolingOffDays);
  return policy.coolingOffDays;
}
