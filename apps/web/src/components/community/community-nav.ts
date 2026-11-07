import type { NavSection } from "@/lib/navigation";
import type { StaffContext } from "@/lib/community/model";

/**
 * The shared Community desk (decision COM-31, 2026-11-07). One address for every staff member an administrator has given a
 * moderation role, whatever their account role is. The page and every RPC behind it check the grant again; the menu entry only saves
 * a click.
 */
export const COMMUNITY_DESK_HREF = "/community-desk";

/** Staff roles whose menu gets the desk entry from here. Admin carries it in its static menu (an admin always has the desk). */
const DESK_ROLES = new Set(["care_coordinator", "clinician", "analyst", "finance"]);

/** Whether the "Community desk" entry is relevant to this person. The database answered community_staff_context; nothing is guessed. */
export function showsCommunityEntry(role: string | null | undefined, ctx: StaffContext | null): boolean {
  if (!ctx || !role || !DESK_ROLES.has(role)) return false;
  return ctx.has_desk;
}

/** Adds the "Community desk" link to a staff menu, only when it is relevant. Returns the sections unchanged otherwise. */
export function withCommunityNav(sections: NavSection[], role: string | null | undefined, ctx: StaffContext | null): NavSection[] {
  if (!showsCommunityEntry(role, ctx)) return sections;
  if (sections.some((s) => s.items.some((i) => i.href === COMMUNITY_DESK_HREF))) return sections;
  const targetIndex = role === "clinician" ? Math.max(0, sections.findIndex((s) => s.label === "Team")) : 0;
  return sections.map((section, i) =>
    i === targetIndex ? { ...section, items: [...section.items, { label: "Community desk", href: COMMUNITY_DESK_HREF, icon: "members" }] } : section,
  );
}

/** Where a desk tab lives. Old per-role addresses redirect here. */
export function communityDeskQueueHref(tab?: string | null): string {
  return tab ? `${COMMUNITY_DESK_HREF}/queue?tab=${encodeURIComponent(tab)}` : `${COMMUNITY_DESK_HREF}/queue`;
}
