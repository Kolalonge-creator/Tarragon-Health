import { formatNumber } from "@/lib/analytics/format";
import type { RefreshQueryState } from "@/lib/queries/list-query-state";

/**
 * What the care coordinator home puts first, worked out apart from React.
 *
 * Everything comes from one read, the open outreach tasks, so there is one
 * state to respect. Two things a coordinator can act on, most urgent first:
 * tasks marked act-first, then self-arranged tests still awaiting a result.
 *
 * A read that never arrived is unknown, never zero: the view then says it
 * could not check rather than "nothing waiting". A "stale" read (a background
 * refresh failed after a good load) keeps its numbers, since the page already
 * says they may have moved on. A read still loading is waited for.
 */

export interface FirstItem {
  key: "act-first" | "follow-ups";
  /** In-page anchor of the panel where the coordinator deals with it. */
  href: string;
  text: string;
}

export type FirstView =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "items"; top: FirstItem; rest: FirstItem[] };

export interface FirstInputs {
  state: RefreshQueryState;
  /** Open tasks marked act-first (priority 1); undefined until the read arrives. */
  actFirst: number | undefined;
  /** Open tasks awaiting a self-arranged test result; undefined until the read arrives. */
  followUps: number | undefined;
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function coordinatorFirstView({ state, actFirst, followUps }: FirstInputs): FirstView {
  if (state === "failed") return { kind: "unknown" };
  if (state === "loading" || actFirst === undefined || followUps === undefined) return { kind: "loading" };

  const items: FirstItem[] = [];
  if (actFirst > 0) {
    items.push({
      key: "act-first",
      href: "#coordinator-act-first",
      text: `${plural(actFirst, "outreach task is", "outreach tasks are")} marked act-first`,
    });
  }
  if (followUps > 0) {
    items.push({
      key: "follow-ups",
      href: "#coordinator-follow-ups",
      text: `${plural(followUps, "test result is", "test results are")} still awaited`,
    });
  }

  if (items.length === 0) return { kind: "clear" };
  const [top, ...rest] = items;
  return { kind: "items", top, rest };
}
