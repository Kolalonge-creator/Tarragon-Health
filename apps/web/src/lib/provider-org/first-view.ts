import { formatNumber } from "@/lib/analytics/format";
import type { ProviderOverview } from "./overview-summary";

/**
 * What the provider organisation home puts first, worked out apart from the page.
 *
 * Uses only the per-status referral counts the page already reads. Two
 * statuses mean the organisation still owes the next step, most pressing
 * first: a referral that is paid and waiting to be booked (the amber status on
 * the referrals page), then one on the waitlist.
 *
 * If the figures did not load the view is "unknown", never "clear": the page
 * already shows the failure notice, and this view must not turn it into good
 * news.
 */

export interface FirstItem {
  key: "paid" | "waitlisted";
  href: string;
  text: string;
}

export type FirstView =
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "items"; top: FirstItem; rest: FirstItem[] };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function providerOrgFirstView(overview: ProviderOverview, orgId: string): FirstView {
  if (overview.kind !== "ready") return { kind: "unknown" };

  const href = `/provider-org/referrals?org=${encodeURIComponent(orgId)}`;
  const byStatus = overview.analytics.referrals_by_status;
  const paid = byStatus.payment_confirmed ?? 0;
  const waitlisted = byStatus.waitlisted ?? 0;

  const items: FirstItem[] = [];
  if (paid > 0) {
    items.push({
      key: "paid",
      href,
      text: `${plural(paid, "referral is", "referrals are")} paid and waiting to be booked`,
    });
  }
  if (waitlisted > 0) {
    items.push({ key: "waitlisted", href, text: `${plural(waitlisted, "referral is", "referrals are")} on the waitlist` });
  }

  if (items.length === 0) return { kind: "clear" };
  const [top, ...rest] = items;
  return { kind: "items", top, rest };
}
