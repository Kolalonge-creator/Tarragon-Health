/**
 * Prevention completion dashboard (spec §2.9/§2.12): "My Preventive Care" as
 * a checklist by category, additive alongside the existing Health Score —
 * never a replacement for it, and never itself presented as a single score.
 * Each category reads as complete (nothing outstanding) or needs attention
 * (something due/overdue), which is the honest, actionable framing the spec
 * asks for instead of one composite number.
 */

export type PreventionCategory =
  | "cardiovascular"
  | "metabolic"
  | "kidney"
  | "respiratory"
  | "cancer"
  | "womens_health"
  | "mens_health"
  | "mental_wellbeing"
  | "vaccination"
  | "lifestyle"
  | "general_health";

export const PREVENTION_CATEGORY_LABEL: Record<PreventionCategory, string> = {
  cardiovascular: "Blood pressure & heart",
  metabolic: "Diabetes screening",
  kidney: "Kidney health",
  respiratory: "Respiratory health",
  cancer: "Cancer screening",
  womens_health: "Women's health",
  mens_health: "Men's health",
  mental_wellbeing: "Mental wellbeing",
  vaccination: "Vaccination",
  lifestyle: "Lifestyle check-in",
  general_health: "General health",
};

export type ItemStatus = "pending" | "booked" | "completed" | "overdue" | "cancelled" | "declined";

export interface PreventionItem {
  category: PreventionCategory;
  status: ItemStatus;
}

export type CategoryCompletionStatus = "complete" | "needs_attention";

export interface PreventionCategorySummary {
  category: PreventionCategory;
  status: CategoryCompletionStatus;
  dueCount: number;
  overdueCount: number;
  totalCount: number;
}

const OUTSTANDING_STATUSES: ItemStatus[] = ["pending", "booked", "overdue"];

/**
 * Rolls a flat list of preventive-care items (already resolved to a
 * category — screenings via screen_types.category, vaccinations tagged
 * 'vaccination') up to one summary row per category. A category with no
 * items at all reads as 'complete' — nothing is outstanding, which is the
 * same "don't show what doesn't apply" convention the rest of the
 * prevention engine already uses (see risk-questionnaire-engine.ts's
 * sex-gating), not a claim that the category was checked and found fine.
 */
export function computePreventionCompletion(items: PreventionItem[]): PreventionCategorySummary[] {
  const byCategory = new Map<PreventionCategory, PreventionItem[]>();
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const summaries: PreventionCategorySummary[] = [];
  for (const [category, categoryItems] of byCategory) {
    const overdueCount = categoryItems.filter((i) => i.status === "overdue").length;
    const dueCount = categoryItems.filter((i) => i.status === "pending" || i.status === "booked").length;
    const needsAttention = categoryItems.some((i) => OUTSTANDING_STATUSES.includes(i.status));
    summaries.push({
      category,
      status: needsAttention ? "needs_attention" : "complete",
      dueCount,
      overdueCount,
      totalCount: categoryItems.length,
    });
  }
  return summaries;
}

const LIFESTYLE_REASSESSMENT_MONTHS = 12;

/**
 * The "Lifestyle" row is derived, not stored: due when the patient has
 * never completed the risk assessment, or hasn't retaken it in the last
 * LIFESTYLE_REASSESSMENT_MONTHS months (spec §2.14's annual reassessment
 * cadence). Retaking the risk assessment (lib/rules/risk-questionnaire-
 * engine.ts) is itself the lifestyle check-in.
 */
export function lifestyleCategoryStatus(
  lastAssessedAt: string | null,
  today: Date = new Date(),
): PreventionCategorySummary {
  if (!lastAssessedAt) {
    return { category: "lifestyle", status: "needs_attention", dueCount: 1, overdueCount: 0, totalCount: 1 };
  }
  const last = new Date(lastAssessedAt);
  const monthsSince =
    (today.getFullYear() - last.getFullYear()) * 12 + (today.getMonth() - last.getMonth());
  const due = monthsSince >= LIFESTYLE_REASSESSMENT_MONTHS;
  return {
    category: "lifestyle",
    status: due ? "needs_attention" : "complete",
    dueCount: due ? 1 : 0,
    overdueCount: 0,
    totalCount: 1,
  };
}
