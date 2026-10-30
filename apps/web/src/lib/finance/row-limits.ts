/**
 * How many rows each finance list asks the database for, and the one rule for
 * telling a person the list was cut off.
 *
 * The reporting RPCs return their newest N rows and say nothing about the rest
 * (200 ledger entries, 200 audit-log rows, 100 approvals, 50 transactions per
 * patient). A list that stops at N under a heading like "Every posted entry"
 * is false from entry N+1 on, and the only sign is that the list is exactly N
 * long. So a list that reaches its limit says so.
 */
export const LEDGER_PAGE_LIMIT = 200;
export const AUDIT_LOG_PAGE_LIMIT = 200;
export const APPROVAL_HISTORY_LIMIT = 100;
export const UNIFIED_LEDGER_PAGE_LIMIT = 50;

/** The printed audit pack asks for far more, and says so if even that is not enough. */
export const PACK_LEDGER_LIMIT = 5000;
export const PACK_AUDIT_LOG_LIMIT = 5000;
export const PACK_APPROVAL_LIMIT = 1000;

/** True when a list is exactly as long as the limit it asked for, so there may be more behind it. */
export function hitLimit(count: number | undefined, limit: number): boolean {
  return count !== undefined && count >= limit;
}
