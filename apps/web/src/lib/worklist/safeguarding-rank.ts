import type { BadgeProps } from "@/components/ui/badge";

/**
 * Ordering and status colour for the safeguarding worklist.
 *
 * The page previously ordered strictly by created_at desc and badged every
 * category red, so a closed "other / needs triage" concern from this morning
 * outranked an open immediate-safety-risk from yesterday, and nothing in the
 * list stood out from anything else. Red on every row is the same as red on
 * no row.
 *
 * Category severity is a triage ordering for a queue, not a clinical
 * classification: it decides which row a reviewer's eye lands on first, and
 * nothing else. Every concern here still needs a human review.
 */

const CATEGORY_RANK: Record<string, number> = {
  immediate_safety_risk: 0,
  child_safety: 1,
  vulnerable_adult: 1,
  abuse: 2,
  exploitation: 2,
  neglect: 2,
  other: 3,
};

const STATUS_RANK: Record<string, number> = {
  open: 0,
  under_review: 1,
  closed: 2,
};

export function safeguardingCategoryRank(category: string): number {
  return CATEGORY_RANK[category] ?? 3;
}

/** Red only for the categories that mean somebody may be in danger right
 * now; amber for the rest of the open work; grey once a concern is closed. */
export function safeguardingCategoryVariant(
  category: string,
  status: string
): NonNullable<BadgeProps["variant"]> {
  if (status === "closed") return "grey";
  return safeguardingCategoryRank(category) === 0 ? "red" : "amber";
}

export interface RankableConcern {
  status: string;
  concern_category: string;
  created_at: string;
}

/** Open before under review before closed; then most severe category; then
 * oldest first, because an old open concern is the worrying one. */
export function compareSafeguardingConcerns(a: RankableConcern, b: RankableConcern): number {
  const statusDiff = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3);
  if (statusDiff !== 0) return statusDiff;
  const categoryDiff =
    safeguardingCategoryRank(a.concern_category) - safeguardingCategoryRank(b.concern_category);
  if (categoryDiff !== 0) return categoryDiff;
  // Closed cases read better newest-first (a log); open ones oldest-first (a queue).
  return a.status === "closed"
    ? b.created_at.localeCompare(a.created_at)
    : a.created_at.localeCompare(b.created_at);
}
