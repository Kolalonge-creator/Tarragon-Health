/**
 * Clinical Decision Support §38.11 (avoid alert fatigue) and §38.12 (a
 * clinician's decision is recorded and, until the facts change, respected).
 *
 * PURE, same discipline as engine.ts — takes recommendations and a plain
 * decision history, returns what should actually be shown. No I/O.
 *
 * TWO SEPARATE MECHANISMS, deliberately not conflated:
 *
 *   1. SETTLED — a recommendation the clinician already decided on, where the
 *      underlying facts (the fingerprint) have not changed since. This is
 *      filtered out entirely, not merely de-prioritised: re-showing "BP
 *      remains uncontrolled" every visit after a doctor has already actioned
 *      it is exactly the fatigue §38.11 warns about. The moment the
 *      fingerprint changes (a new average, a different drug combination), the
 *      recommendation is a materially different fact and resurfaces
 *      regardless of the old decision — CLAUDE.md's "never deprioritise or
 *      silently swallow" applies here as much as to an abnormal result.
 *
 *   2. THE FATIGUE CAP — even after settled items are removed, a genuinely
 *      complex chart could still produce more findings than a clinician can
 *      absorb in one visit. Rather than pretend that never happens, the
 *      remainder is ranked by priority and truncated, with the count of what
 *      was hidden this way surfaced (never silently dropped) so a UI can say
 *      "3 more, lowest priority" instead of just stopping.
 */
import type { CdsRecommendation, CdsPriority } from "./types";

/**
 * §38.11's literal example is "25 alerts in a 10-minute consultation" as the
 * failure mode to avoid — this is deliberately a small fraction of that, high
 * enough that a genuinely multi-problem patient still sees every high-priority
 * item, low enough that a clean-but-busy record doesn't relearn the same
 * lesson 25 was there to prevent.
 */
export const MAX_VISIBLE_RECOMMENDATIONS = 8;

const PRIORITY_RANK: Record<CdsPriority, number> = { high: 0, medium: 1, low: 2 };

export interface CdsDecisionRecord {
  recommendationKey: string;
  /** The fingerprint that was true WHEN this decision was made. */
  fingerprint: string;
  decision: "accepted" | "actioned" | "overridden" | "deferred";
  /** ISO timestamp. Only meaningful for a 'deferred' decision. */
  suppressUntil: string | null;
  /** ISO timestamp — used only to pick the latest decision per key. */
  decidedAt: string;
}

export interface PrioritisedCds {
  visible: CdsRecommendation[];
  /** Recommendations hidden because a clinician already decided on them and nothing material has changed since. */
  settled: CdsRecommendation[];
  /** Recommendations that survived the settled-filter but were cut purely by MAX_VISIBLE_RECOMMENDATIONS — never silently dropped, always countable. */
  overflow: CdsRecommendation[];
}

function latestDecisionPerKey(decisions: CdsDecisionRecord[]): Map<string, CdsDecisionRecord> {
  const latest = new Map<string, CdsDecisionRecord>();
  for (const decision of decisions) {
    const existing = latest.get(decision.recommendationKey);
    if (!existing || decision.decidedAt > existing.decidedAt) {
      latest.set(decision.recommendationKey, decision);
    }
  }
  return latest;
}

/** Whether `rec` should stay hidden given the latest decision on its key, at instant `now`. */
function isSettled(rec: CdsRecommendation, decision: CdsDecisionRecord | undefined, now: Date): boolean {
  if (!decision) return false;
  if (decision.fingerprint !== rec.fingerprint) return false; // the facts moved on — this is not the same recommendation any more
  if (decision.decision === "deferred") {
    // A deferral without a return date should never exist (the DB's
    // cds_decisions_deferral_returns CHECK enforces it) — if it somehow does,
    // fail open (resurface) rather than hide a recommendation forever.
    if (!decision.suppressUntil) return false;
    return new Date(decision.suppressUntil) > now;
  }
  // accepted / actioned / overridden, same facts as when decided: stays settled.
  return true;
}

export function prioritiseCdsRecommendations(
  recommendations: CdsRecommendation[],
  decisions: CdsDecisionRecord[],
  now: Date = new Date(),
): PrioritisedCds {
  const latest = latestDecisionPerKey(decisions);

  const settled: CdsRecommendation[] = [];
  const unsettled: CdsRecommendation[] = [];
  for (const rec of recommendations) {
    if (isSettled(rec, latest.get(rec.key), now)) {
      settled.push(rec);
    } else {
      unsettled.push(rec);
    }
  }

  // Stable priority sort (Array#sort is stable per spec): equal-priority
  // items keep the engine's own ordering rather than being reshuffled.
  const ranked = [...unsettled].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  const visible = ranked.slice(0, MAX_VISIBLE_RECOMMENDATIONS);
  const overflow = ranked.slice(MAX_VISIBLE_RECOMMENDATIONS);

  return { visible, settled, overflow };
}
