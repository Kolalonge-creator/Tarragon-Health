import type { HealthEducationContent } from "@/lib/queries/health-education";

/** The Lagos calendar day, as YYYY-MM-DD: the same day the database uses to expire content. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

/** F1 rule (mirrors private.health_education_content_expired): only an item's own review date expires it. */
export function isPastReviewDate(
  item: Pick<HealthEducationContent, "next_review_due">,
  today: string = lagosToday()
): boolean {
  return item.next_review_due !== null && item.next_review_due <= today;
}

/**
 * Items flagged for re-review (for example by a protocol version bump) that patients still see.
 * OQ-F1-04: a flag is a visible admin notice, never a silent outage.
 */
export function flaggedButStillLive<T extends Pick<HealthEducationContent, "content_status" | "is_active" | "next_review_due">>(
  items: T[],
  today: string = lagosToday()
): T[] {
  return items.filter((i) => i.content_status === "review_due" && i.is_active && !isPastReviewDate(i, today));
}
