/** Today in Africa/Lagos (UTC+1, no daylight saving) as YYYY-MM-DD. */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ExpiryFields {
  /** Accepted for callers that hold it, but NOT consulted: a review_due status is a flag, not expiry (OQ-F1-04). */
  readonly status?: string | null;
  /** YYYY-MM-DD, the authoritative review date. */
  readonly nextReviewDue?: string | null;
}

/**
 * The F1 rule, applied on the phone for content saved offline: an item is expired when its OWN review date is today or earlier
 * (Lagos). Items with no review date never time-expire. A review_due status alone (a protocol version bump flags content for
 * re-review) does NOT expire an item: it keeps being served until its own date, with a visible admin notice (OQ-F1-04).
 * Mirrors private.health_education_content_expired() in the database.
 */
export function isExpired(item: ExpiryFields, now: Date = new Date()): boolean {
  return item.nextReviewDue != null && item.nextReviewDue <= lagosToday(now);
}
