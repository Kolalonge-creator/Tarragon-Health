import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * S28e (spec 21.7): the pharmacy scorecard. Pure: no I/O. The database computes every figure (public.pharmacy_scorecard); this only reads the answer
 * and says what it means. A flag is a SUGGESTION for staff to review. Nothing here, and nothing in the database for a pharmacy, removes a pharmacy by
 * itself: a person pauses it from new work with a written reason on the partner quality page.
 */
export const scorecardRowSchema = z.object({
  partner_id: z.string().uuid(),
  partner_name: z.string(),
  is_active: z.boolean(),
  work_state: z.string(),
  reason_codes: z.array(z.string()),
  override_until: z.string().nullable(),
  score: z.number().nullable(),
  suggestions: z.array(z.string()),
  review_suggested: z.boolean(),
  licence_state: z.string(),
  licence_expires_at: z.string().nullable(),
  licence_days_left: z.number().nullable(),
  dispense_target_hours: z.number().nullable(),
  dispense_median_hours: z.number().nullable(),
  pct_within_target: z.number().nullable(),
  dispenses_measured: z.number(),
  sent_measured: z.number(),
  flags_raised: z.number(),
  out_of_stock_flags: z.number(),
  complaints_upheld: z.number(),
  complaints_open: z.number(),
  computed_at: z.string().nullable(),
});
export type ScorecardRow = z.infer<typeof scorecardRowSchema>;
export const scorecardRowsSchema = z.array(scorecardRowSchema);

/** An unreadable answer is a failed read: an empty list would read as "no pharmacy needs a look". */
export function parseScorecard(data: unknown): ScorecardRow[] | null {
  const parsed = scorecardRowsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const FLAG_KEYS: Record<string, MessageKey> = {
  licence_expired: "pharmscore.flag.licence_expired",
  licence_expiring: "pharmscore.flag.licence_expiring",
  complaints_upheld_limit: "pharmscore.flag.complaints_upheld_limit",
  dispense_turnaround_slow: "pharmscore.flag.dispense_turnaround_slow",
  out_of_stock_often: "pharmscore.flag.out_of_stock_often",
  score_below_floor: "pharmscore.flag.score_below_floor",
};
/** The sentence for a suggestion code. An unknown code is shown as a neutral prompt to look, never hidden. */
export function flagKey(code: string): MessageKey {
  return FLAG_KEYS[code] ?? "pharmscore.review";
}

export type LicenceTone = "red" | "amber" | "green" | "grey";
/** How the licence reads at a glance: expired is red, inside the warning window amber, no date on file grey. */
export function licenceTone(row: Pick<ScorecardRow, "licence_state" | "licence_days_left">): LicenceTone {
  if (row.licence_state === "expired" || (row.licence_days_left !== null && row.licence_days_left < 0)) return "red";
  if (row.licence_state === "expiring") return "amber";
  if (row.licence_state === "unverified" || row.licence_days_left === null) return "grey";
  return "green";
}

/** Review-suggested pharmacies first, then paused, then the rest by name, so what needs a look is at the top. */
export function orderForReview(rows: ScorecardRow[]): ScorecardRow[] {
  const rank = (r: ScorecardRow) => (r.review_suggested ? 0 : r.work_state === "suspended" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || Number(b.is_active) - Number(a.is_active) || a.partner_name.localeCompare(b.partner_name));
}
