/**
 * Heart Age — a SCORE2 risk-age conversion (see services/ml/app/scoring/
 * heart_age.py for the actual computation and its clinical/methodology
 * notes). Every value here is computed server-side by the ML service and
 * stored verbatim in patient_risk_scores (score_type='heart_age') by
 * screening-result-actions.ts's maybeComputeCvdRisk — this module only
 * turns that stored history into a "since you started" trend line, the
 * same job health-score.ts's computeHealthScoreTrend/describeHealthScoreTrend
 * do for the Health Score. Unlike the retired Biological Age card, no
 * re-derivation happens at read time: the age itself is a real, stored
 * SCORE2 output, not a value recomputed on the fly from another score.
 */

export interface HeartAgeHistoryPoint {
  score: number | null;
  computed_at: string;
}

export interface HeartAgeTrend {
  firstAge: number;
  lastAge: number;
  firstDate: string;
  lastDate: string;
  ageDelta: number;
}

/**
 * Turns raw ascending Heart Age history into a trend — never fabricated
 * from a single point. Returns null with fewer than two real, scored data
 * points, since there is nothing honest to say about a trend from one.
 */
export function computeHeartAgeTrend(history: HeartAgeHistoryPoint[]): HeartAgeTrend | null {
  const scored = history.filter(
    (h): h is { score: number; computed_at: string } => h.score !== null,
  );
  if (scored.length < 2) return null;
  const first = scored[0];
  const last = scored[scored.length - 1];
  return {
    firstAge: first.score,
    lastAge: last.score,
    firstDate: first.computed_at,
    lastDate: last.computed_at,
    ageDelta: last.score - first.score,
  };
}

/**
 * Plain-language line for the trend above — non-alarming either direction,
 * matching the brand voice's "doctor who knows your name" rule (no
 * fear-based urgency for a rise, no overclaiming for a fall).
 */
export function describeHeartAgeTrend(trend: HeartAgeTrend): string {
  const { firstAge, lastAge, ageDelta } = trend;
  if (ageDelta === 0) {
    return `Since your first cholesterol panel, your Heart Age has held steady at ${lastAge} years.`;
  }
  if (ageDelta < 0) {
    return `Since your first cholesterol panel, your Heart Age has moved from ${firstAge} to ${lastAge} years — real, measurable progress.`;
  }
  return `Since your first cholesterol panel, your Heart Age has moved from ${firstAge} to ${lastAge} years — nothing to panic about, just something worth a look with your care team.`;
}
