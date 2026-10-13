import type { GroupList } from "./model";

/**
 * Whether the Community entry (the More menu tile, and the screen itself) may be shown at all. Pure, so it is tested.
 *
 *   - Someone with a supported person's account open ("acting for") never sees Community: it belongs to a person's own account, and
 *     nobody joins on another person's behalf.
 *   - A supporter-only account (profiles.receives_care === false) never sees it either.
 *   - Until the go-live guard is on (open) and the person is an adult (adult), there is no menu entry. The screen itself, if reached,
 *     says the calm not-open or adults-only line (see communityGate).
 *   - While the answer is unknown (still loading, or the read failed) the entry stays hidden: a menu item that might lead nowhere is
 *     worse than none.
 */
export interface CommunityEntryInput {
  /** True while a supported person's account is open on this device. */
  acting: boolean;
  /** profiles.receives_care for the signed-in account; null while unknown. */
  receivesCare: boolean | null;
  /** The parsed community_list_groups reply; undefined if it has not loaded or did not parse. */
  list: Pick<GroupList, "open" | "adult"> | undefined;
}

export function showCommunityEntry({ acting, receivesCare, list }: CommunityEntryInput): boolean {
  if (acting) return false;
  if (receivesCare !== true) return false;
  return list !== undefined && list.open && list.adult;
}

export type CommunityGate = "ready" | "not_open" | "adults_only";

/** What the screen shows once the list is read: the groups, or exactly one calm line. A closed guard wins over the adult check. */
export function communityGate(list: Pick<GroupList, "open" | "adult"> | undefined): CommunityGate {
  if (list === undefined || !list.open) return "not_open";
  if (!list.adult) return "adults_only";
  return "ready";
}
