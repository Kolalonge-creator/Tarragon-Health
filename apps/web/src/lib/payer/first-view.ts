import { formatNumber } from "@/lib/analytics/format";
import type { PayerQueueCounts } from "./queue-counts";

/**
 * What the payer home puts first, worked out apart from the page.
 *
 * The payer's work is three queues, most time-sensitive first: a
 * pre-authorisation waiting for a decision (a member may be waiting on care),
 * a claim waiting to be adjudicated, and an approved claim waiting to be paid.
 *
 * A queue whose read failed is unknown, never zero: the view never says
 * nothing is waiting, it says it could not check, or marks the list
 * incomplete when something did show.
 */

export interface FirstItem {
  key: "preauth" | "adjudicate" | "pay";
  href: string;
  text: string;
}

export type FirstView =
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "items"; top: FirstItem; rest: FirstItem[]; incomplete: boolean };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function payerFirstView(counts: PayerQueueCounts, insurerId: string): FirstView {
  const q = `?insurer=${encodeURIComponent(insurerId)}`;
  const items: FirstItem[] = [];

  if (counts.preauthPending !== null && counts.preauthPending > 0) {
    items.push({
      key: "preauth",
      href: `/payer/preauthorizations${q}`,
      text: `${plural(counts.preauthPending, "pre-authorisation is", "pre-authorisations are")} waiting for a decision`,
    });
  }
  if (counts.claimsToAdjudicate !== null && counts.claimsToAdjudicate > 0) {
    items.push({
      key: "adjudicate",
      href: `/payer/claims${q}`,
      text: `${plural(counts.claimsToAdjudicate, "claim is", "claims are")} waiting to be adjudicated`,
    });
  }
  if (counts.claimsToPay !== null && counts.claimsToPay > 0) {
    items.push({
      key: "pay",
      href: `/payer/claims${q}`,
      text: `${plural(counts.claimsToPay, "approved claim is", "approved claims are")} waiting to be paid`,
    });
  }

  const failed =
    counts.preauthPending === null || counts.claimsToAdjudicate === null || counts.claimsToPay === null;

  if (items.length > 0) {
    const [top, ...rest] = items;
    return { kind: "items", top, rest, incomplete: failed };
  }
  return failed ? { kind: "unknown" } : { kind: "clear" };
}
