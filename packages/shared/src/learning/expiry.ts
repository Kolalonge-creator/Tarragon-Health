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

/** A row of the expiry backlog as the database function returns it (only the fields the screen groups on). */
export interface BacklogRow {
  readonly bucket: string;
  readonly days_until_due: number;
}

export interface BacklogGroup<T extends BacklogRow> {
  /** "hidden", or "d<number>" for a threshold taken from configuration. */
  readonly bucket: string;
  /** The threshold in days for a "d<number>" bucket, null for "hidden". */
  readonly days: number | null;
  readonly rows: readonly T[];
}

/** The threshold a bucket name stands for: "d14" is 14, "hidden" and anything else is null. */
export function bucketDays(bucket: string): number | null {
  const m = /^d(\d{1,4})$/.exec(bucket);
  return m ? Number(m[1]) : null;
}

/**
 * Groups backlog rows for display: hidden first, then the smallest threshold (most urgent) to the largest. Buckets come from the rows,
 * never from a list written here, so a changed threshold setting changes the screen without a code change. Within a bucket the rows keep
 * the order the database gave them (soonest review date first). An empty bucket is not returned.
 */
export function groupBacklog<T extends BacklogRow>(rows: readonly T[]): BacklogGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    if (bucketDays(r.bucket) === null && r.bucket !== "hidden") continue;
    by.set(r.bucket, [...(by.get(r.bucket) ?? []), r]);
  }
  return [...by.entries()]
    .map(([bucket, rs]) => ({ bucket, days: bucketDays(bucket), rows: rs }))
    .sort((a, b) => (a.days ?? -1) - (b.days ?? -1));
}
