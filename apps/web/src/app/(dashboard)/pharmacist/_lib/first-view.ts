import { formatNumber } from "@/lib/analytics/format";
import type { PharmacistOverview } from "./overview-summary";

/**
 * What the pharmacist home puts first, worked out apart from React.
 *
 * Most urgent first: an expired licence (the pharmacy should not be
 * dispensing), orders waiting on the pharmacist, then a licence that expires
 * soon.
 *
 * A figure with no data is unknown, never zero. With nothing to show the view
 * says "clear" only when orders and profile were both read and are current.
 * Stale data (a refresh failed after a good read) still shows what it has but
 * is flagged, and a stale all-clear is "stale", not "clear".
 */

export interface FirstItem {
  key: "licence-expired" | "orders" | "licence-soon";
  href: string;
  text: string;
}

export type FirstView =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "stale" }
  | { kind: "clear" }
  | { kind: "items"; top: FirstItem; rest: FirstItem[]; caveat: "none" | "incomplete" | "stale" };

export function pharmacistFirstView(view: PharmacistOverview): FirstView {
  const items: FirstItem[] = [];
  const { orders, profile } = view;

  const licenceKnown = profile.kind !== "unknown";
  const tone = profile.kind === "ready" ? profile.expires.tone : "ok";

  if (tone === "expired") {
    items.push({ key: "licence-expired", href: "/pharmacist/profile", text: "Your pharmacy licence has expired" });
  }
  if (orders.awaitingCount !== null && orders.awaitingCount > 0) {
    const n = orders.awaitingCount;
    items.push({
      key: "orders",
      href: "/pharmacist/orders",
      text: `${formatNumber(n)} ${n === 1 ? "order is" : "orders are"} waiting for you`,
    });
  }
  if (tone === "soon") {
    items.push({ key: "licence-soon", href: "/pharmacist/profile", text: "Your pharmacy licence expires soon" });
  }

  const ordersFailed = orders.awaitingCount === null && orders.state === "failed";
  const profileFailed = !licenceKnown && profile.state === "failed";
  const failed = ordersFailed || profileFailed;
  const waiting = (orders.awaitingCount === null && orders.state === "loading") || (!licenceKnown && profile.state === "loading");
  const stale = orders.state === "stale" || profile.state === "stale";

  if (items.length > 0) {
    const [top, ...rest] = items;
    return { kind: "items", top, rest, caveat: failed ? "incomplete" : stale ? "stale" : "none" };
  }
  if (failed) return { kind: "unknown" };
  if (waiting) return { kind: "loading" };
  if (stale) return { kind: "stale" };
  return { kind: "clear" };
}
