import { levelRank } from "./priority";
import type { EscalationLevel } from "@tarragon/shared";

/**
 * Ordering for the results inbox.
 *
 * The page fetched `created_at` ascending and rendered a Severity column that
 * did nothing: an emergency-level result landed wherever its upload time put
 * it, potentially pages below a routine one uploaded that morning. The
 * severity column is now what the list is actually ordered by, using the same
 * ladder every other clinical queue ranks on (lib/worklist/priority.ts), with
 * upload age as the tiebreak.
 *
 * A document with no linked clinician_alert has no severity at all. It sorts
 * behind every classified row rather than being guessed at as "routine",
 * because "unclassified" and "routine" are different facts.
 */

export interface RankableResultRow {
  created_at: string;
  clinician_alert: { level: EscalationLevel } | null;
}

/** Whether a row needs a clinician's eyes ahead of the routine backlog. */
export function isHighSeverityResult(row: RankableResultRow): boolean {
  if (!row.clinician_alert) return false;
  return levelRank(row.clinician_alert.level) <= levelRank("urgent_escalation");
}

export function compareResultRows(a: RankableResultRow, b: RankableResultRow): number {
  const aRank = a.clinician_alert ? levelRank(a.clinician_alert.level) : Number.MAX_SAFE_INTEGER;
  const bRank = b.clinician_alert ? levelRank(b.clinician_alert.level) : Number.MAX_SAFE_INTEGER;
  if (aRank !== bRank) return aRank - bRank;
  return a.created_at.localeCompare(b.created_at);
}
