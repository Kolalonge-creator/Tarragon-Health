import type { NavSection } from "@/lib/navigation";
import type { StaffContext } from "@/lib/community/model";

/** Whether the "Community" entry is relevant to this person. The database answered community_staff_context; nothing is guessed. */
export function showsCommunityEntry(role: string | null | undefined, ctx: StaffContext | null): boolean {
  if (!ctx) return false;
  if (role === "care_coordinator" || role === "analyst" || role === "finance") return ctx.is_moderator || ctx.is_safety_reviewer;
  if (role === "clinician") return ctx.is_cmo || ctx.is_clinician;
  return false;
}

/** Where each staff role's Community page lives. Admin is not here: its menu already carries /admin/community. */
export const COMMUNITY_HREF: Readonly<Record<"care_coordinator" | "clinician" | "analyst" | "finance", string>> = {
  care_coordinator: "/dashboard/care-coordinator/community",
  clinician: "/clinician/community",
  analyst: "/analytics/community",
  finance: "/finance/community",
};

/** Adds the "Community" link to a staff menu, only when it is relevant. Returns the sections unchanged otherwise. */
export function withCommunityNav(sections: NavSection[], role: string | null | undefined, ctx: StaffContext | null): NavSection[] {
  if (!showsCommunityEntry(role, ctx) || (role !== "care_coordinator" && role !== "clinician" && role !== "analyst" && role !== "finance")) return sections;
  const href = COMMUNITY_HREF[role];
  if (sections.some((s) => s.items.some((i) => i.href === href))) return sections;
  const targetIndex = role === "clinician" ? Math.max(0, sections.findIndex((s) => s.label === "My work")) : 0;
  return sections.map((section, i) =>
    i === targetIndex ? { ...section, items: [...section.items, { label: "Community", href, icon: "members" }] } : section,
  );
}
