/**
 * Reliable change for PHQ-9 and GAD-7 totals (D4). Pure code: no network, no database, no threshold of its own.
 *
 * The number of points that counts as "reliable" is a PROPOSED clinical value owned by the CMO. It lives in the versioned configuration
 * (`outcomes.reliable_change_rules` in ./proposed-config, and `outcome_reliable_change_config` in the database, unsigned and inactive until the CMO signs)
 * and is always passed in. Nothing here supplies a default, so an unsigned or missing value cannot turn into a figure.
 *
 * Only TOTAL scores are ever passed to these functions. They take no answer to a single question and no safety flag.
 *
 * The same rule as `private.reliable_change_class` in the database; reliable-change.test.ts pins the two together:
 *   change = score - baseline
 *   a fall of at least `points`  -> reliable_improvement
 *   a rise of at least `points`  -> reliable_deterioration
 *   anything else, both known    -> no_reliable_change (not a statement that nothing changed)
 *   a missing score or baseline, or a points value that is not a whole number of 1 or more -> insufficient_data
 */
export const RELIABLE_CHANGE_CATEGORIES = ["reliable_improvement", "no_reliable_change", "reliable_deterioration", "insufficient_data"] as const;
export type ReliableChangeCategory = (typeof RELIABLE_CHANGE_CATEGORIES)[number];

export type ReliableChangeInstrument = "phq9" | "gad7";

export function classifyReliableChange(baseline: number | null | undefined, score: number | null | undefined, points: number | null | undefined): ReliableChangeCategory {
  if (baseline == null || score == null || points == null) return "insufficient_data";
  if (!Number.isInteger(baseline) || !Number.isInteger(score) || !Number.isInteger(points) || points < 1) return "insufficient_data";
  const change = score - baseline;
  if (change <= -points) return "reliable_improvement";
  if (change >= points) return "reliable_deterioration";
  return "no_reliable_change";
}

export type ReliableChangeCounts = Record<ReliableChangeCategory, number> & { n: number };

/** Counts a group of (baseline, score) pairs. The caller decides who is in the group (the same people the response figure counts). */
export function summariseReliableChange(pairs: readonly { baseline: number | null; score: number | null }[], points: number | null): ReliableChangeCounts {
  const out: ReliableChangeCounts = { reliable_improvement: 0, no_reliable_change: 0, reliable_deterioration: 0, insufficient_data: 0, n: 0 };
  for (const p of pairs) {
    out[classifyReliableChange(p.baseline, p.score, points)] += 1;
    out.n += 1;
  }
  return out;
}

/** The points for one instrument from a reliable-change configuration value, or null when the value is not usable (the caller then shows nothing). */
export function reliableChangePoints(config: unknown, instrument: ReliableChangeInstrument): number | null {
  if (typeof config !== "object" || config === null) return null;
  const instruments = (config as { instruments?: unknown }).instruments;
  if (typeof instruments !== "object" || instruments === null) return null;
  const one = (instruments as Record<string, unknown>)[instrument];
  if (typeof one !== "object" || one === null) return null;
  const p = (one as { reliable_change_points?: unknown }).reliable_change_points;
  return typeof p === "number" && Number.isInteger(p) && p >= 1 ? p : null;
}
