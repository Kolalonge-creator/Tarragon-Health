/** Today in Africa/Lagos (UTC+1, no daylight saving) as YYYY-MM-DD. */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ExpiryFields {
  readonly status?: string | null;
  /** YYYY-MM-DD, the authoritative review date. */
  readonly nextReviewDue?: string | null;
}

/**
 * The F1 rule, applied on the phone for content saved offline: an item is expired when its status is review_due or its
 * review date is today or earlier (Lagos). Items with no review date never time-expire. Mirrors
 * private.health_education_content_expired() in the database.
 */
export function isExpired(item: ExpiryFields, now: Date = new Date()): boolean {
  if (item.status === "review_due") return true;
  return item.nextReviewDue != null && item.nextReviewDue <= lagosToday(now);
}
