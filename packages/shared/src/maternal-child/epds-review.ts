import { getProposedConfig } from "../proposed-config";

/**
 * EPDS routing (CMO pack A6, PROPOSED, NOT SIGNED). Pure and deterministic: no model, no network (INV-01).
 * The database is the authority (private.enforce_epds_rules recomputes all of this from the stored answers); this mirror is for the screen
 * ("what happens next") and for the tests that pin the item 10 rule.
 */
export interface EpdsCutoffs {
  readonly item_count: number;
  readonly possible_min: number;
  readonly probable_min: number;
  readonly possible_review_within_days: number;
  readonly probable_review_within_hours: number;
  readonly item_10_any_nonzero_is_crisis: boolean;
}

export type EpdsReviewBand = "none" | "possible" | "probable" | "crisis";

export interface EpdsReview {
  readonly total: number;
  readonly band: EpdsReviewBand;
  /** Any non-zero item 10 goes to the crisis route at once, whatever the total. */
  readonly crisis: boolean;
  /** Hours until a clinician review is due; 0 for a crisis; null when no review is asked for. */
  readonly reviewDueInHours: number | null;
  readonly configVersion: number;
}

export function currentEpdsCutoffs(): { cutoffs: EpdsCutoffs; version: number } {
  const c = getProposedConfig<Record<string, number | boolean>>("maternal_child.epds.cutoffs");
  return { cutoffs: c.value as unknown as EpdsCutoffs, version: c.version };
}

export function reviewEpds(items: readonly number[], source = currentEpdsCutoffs()): EpdsReview {
  const { cutoffs, version } = source;
  if (items.length !== cutoffs.item_count) throw new Error(`An EPDS screen needs exactly ${cutoffs.item_count} answers`);
  for (const v of items) {
    if (!Number.isInteger(v) || v < 0 || v > 3) throw new Error("Each EPDS answer must be a whole number from 0 to 3");
  }
  const total = items.reduce((a, b) => a + b, 0);
  const item10 = items[cutoffs.item_count - 1] ?? 0;
  if (cutoffs.item_10_any_nonzero_is_crisis && item10 > 0) {
    return { total, band: "crisis", crisis: true, reviewDueInHours: 0, configVersion: version };
  }
  if (total >= cutoffs.probable_min) {
    return { total, band: "probable", crisis: false, reviewDueInHours: cutoffs.probable_review_within_hours, configVersion: version };
  }
  if (total >= cutoffs.possible_min) {
    return { total, band: "possible", crisis: false, reviewDueInHours: cutoffs.possible_review_within_days * 24, configVersion: version };
  }
  return { total, band: "none", crisis: false, reviewDueInHours: null, configVersion: version };
}
