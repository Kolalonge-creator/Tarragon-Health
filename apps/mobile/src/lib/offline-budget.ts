/**
 * Performance and low-data tuning for the offline store (S06, spec section 11
 * and D.1). These are PROPOSED engineering values, not clinical ones. They are
 * the targets the budget tests in offline-budget.test.ts hold the code to on
 * the Jest SQLite stand-in.
 *
 * NOT MEASURED ON A DEVICE: cold start, installed size and real memory have no
 * device here. (Decision DG-1, 2026-10-02: the floor is now a 4 GB Android 10+
 * or iOS 16+ phone, not the 2 GB phone the original targets named; the stand-in
 * budgets below are still a useful order-of-magnitude guard.) Those three
 * stay open until a device lab run; nothing in this file or its tests claims
 * them as met.
 */
export const OFFLINE_BUDGET = {
  /** Rows per pull page: keeps one response small on a slow connection. */
  pullPageSize: 200,
  /** Pages per pull run, so a background run cannot spin for long. */
  maxPagesPerPull: 10,
  /** First pull on a new phone reads this much history only, not everything. */
  initialPullDays: 90,
  /** Mirror rows older than this, measured back from the newest mirrored row, are purged. */
  mirrorRetentionDays: 90,
  /** Stand-in budgets (milliseconds / bytes) for the jest tests. */
  enqueueMsMax: 50,
  pullUpsertMsPer1000Rows: 1500,
  outboxDbBytesPer1000Rows: 1_000_000,
  /** Spec D.1: typical daily data use under 1 MB without media. */
  dailyBytesMax: 1_000_000,
} as const;
