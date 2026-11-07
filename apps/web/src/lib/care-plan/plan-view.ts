import type { Enums, Tables } from "@tarragon/shared";

export type CarePlanActionCategory = Enums<"care_plan_action_category">;
export type CarePlanRevision = Tables<"care_plan_revisions">;

/** The order categories are shown in, everywhere (patient page and clinician picker). */
export const CARE_PLAN_CATEGORY_ORDER: readonly CarePlanActionCategory[] = [
  "goals",
  "tests",
  "monitoring",
  "medicines",
  "lifestyle",
  "screening",
  "consultations",
  "follow_up",
];

export function isCarePlanActionCategory(value: unknown): value is CarePlanActionCategory {
  return typeof value === "string" && (CARE_PLAN_CATEGORY_ORDER as readonly string[]).includes(value);
}

/** One action as the patient sees it, whether it comes from the live table or a frozen revision snapshot. */
export type PlanActionView = {
  description: string;
  frequency: string | null;
  category: CarePlanActionCategory | null;
  why: string | null;
  when: string | null;
  how: string | null;
};

export type ActionGroup = { category: CarePlanActionCategory | null; actions: PlanActionView[] };

/** Groups actions by category in the fixed order; actions with no category come last in their own group. */
export function groupActionsByCategory(actions: readonly PlanActionView[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  for (const category of CARE_PLAN_CATEGORY_ORDER) {
    const inCategory = actions.filter((a) => a.category === category);
    if (inCategory.length > 0) groups.push({ category, actions: inCategory });
  }
  const uncategorised = actions.filter((a) => a.category === null);
  if (uncategorised.length > 0) groups.push({ category: null, actions: uncategorised });
  return groups;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Reads the actions out of a revision's plan_snapshot defensively: anything malformed is skipped, never thrown. */
export function snapshotActions(snapshot: unknown): PlanActionView[] {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return [];
  const raw = (snapshot as Record<string, unknown>).actions;
  if (!Array.isArray(raw)) return [];
  const out: PlanActionView[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const description = textOrNull(r.description);
    if (!description) continue;
    out.push({
      description,
      frequency: textOrNull(r.frequency),
      category: isCarePlanActionCategory(r.category) ? r.category : null,
      why: textOrNull(r.why),
      when: textOrNull(r.when),
      how: textOrNull(r.how),
    });
  }
  return out;
}

/** Changes the doctor marked as needing the patient's acknowledgement that the patient has not yet acknowledged, oldest first. */
export function pendingAcknowledgements(revisions: readonly CarePlanRevision[]): CarePlanRevision[] {
  return revisions
    .filter((r) => r.needs_acknowledgement && r.acknowledged_at === null)
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
}

/** A plan date in Lagos time, e.g. "7 Nov 2026"; null in, null out. A bare YYYY-MM-DD is read as that calendar day. */
export function formatPlanDate(value: string | null): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+01:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
