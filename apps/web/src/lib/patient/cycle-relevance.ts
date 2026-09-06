import type { Enums } from "@tarragon/shared";

type Sex = Enums<"sex"> | null | undefined;

/**
 * Whether to offer cycle tracking to this patient.
 *
 * The rule is "unless we positively know otherwise", NOT "only if we know
 * so", and the difference is the whole point of this file.
 *
 * The Prevention hub previously required `sex === "female"` exactly. Sex is
 * not asked for at signup, so most accounts carry no value at all — at the
 * time this was written, 58% of patient profiles had `sex` unrecorded
 * against 26% recorded female. Under the strict test the cycle tracker was
 * not merely hard to find for those patients, it had no entry point
 * anywhere in the product: no card, no link, reachable only by typing the
 * URL. A feature invisible to the majority of the people it exists for is
 * not shipped.
 *
 * So an unrecorded value is treated as permissive, the same null-gating
 * principle `reviewed_by`/`reviewed_at` and `doctor_tier` follow elsewhere:
 * an empty column is a gap in our record, not a statement about the patient.
 * The cost of the two mistakes is not symmetric. Offering the card to
 * someone it does not apply to costs them one glance at a card they ignore;
 * withholding it from a woman who came looking for it means the product
 * silently has nothing for her.
 *
 * Only a positively recorded `male` suppresses it.
 */
export function shouldOfferCycleTracking(sex: Sex): boolean {
  return sex !== "male";
}
