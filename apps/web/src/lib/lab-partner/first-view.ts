import { formatNumber } from "@/lib/analytics/format";

/**
 * What the lab partner home puts first, worked out apart from React.
 *
 * Two things a lab can act on, most urgent first: samples already past their
 * turnaround (delayed), then orders that still need a result uploaded.
 *
 * A count that did not load is unknown, never zero. If either source is
 * unknown the view never says "nothing waiting": it says it could not check,
 * or, when something did turn up, that the list may be incomplete. A source
 * that is only still loading is waited for.
 */

export interface FirstItem {
  key: "delayed" | "awaiting";
  /** In-page anchor of the panel where the lab deals with it. */
  href: string;
  text: string;
}

export type FirstView =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "items"; top: FirstItem; rest: FirstItem[]; incomplete: boolean };

export interface FirstInputs {
  /** Orders still needing the lab; null = the orders read failed. */
  awaiting: number | null;
  /** Delayed samples; undefined = not known yet or failed (see `delayedFailed`). */
  delayed: number | undefined;
  delayedFailed: boolean;
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function labPartnerFirstView({ awaiting, delayed, delayedFailed }: FirstInputs): FirstView {
  const items: FirstItem[] = [];

  if (delayed !== undefined && delayed > 0) {
    items.push({
      key: "delayed",
      href: "#lab-samples",
      text: `${plural(delayed, "sample is", "samples are")} past turnaround`,
    });
  }
  if (awaiting !== null && awaiting > 0) {
    items.push({
      key: "awaiting",
      href: "#lab-orders",
      text: `${plural(awaiting, "order needs", "orders need")} a result`,
    });
  }

  const ordersUnknown = awaiting === null;
  const samplesUnknown = delayed === undefined;
  const failed = ordersUnknown || (samplesUnknown && delayedFailed);
  const waiting = !failed && samplesUnknown;

  if (items.length > 0) {
    const [top, ...rest] = items;
    return { kind: "items", top, rest, incomplete: failed };
  }
  if (failed) return { kind: "unknown" };
  if (waiting) return { kind: "loading" };
  return { kind: "clear" };
}
