import { z } from "zod";

/**
 * S80 gap closure (25.6): shapes of the two read-only settlement tie-out functions. Money is integer kobo (INV-15). The three classes are the
 * ones finance asked for; "other" carries amount differences and settlement total problems. Nothing here builds a mutation.
 */
export const CLASS_LABEL: Record<string, string> = {
  missing_in_ledger: "Settled by Paystack, missing in our ledger",
  missing_at_paystack: "Paid to us, missing at Paystack",
  other: "Other difference (amount or settlement total)",
};

export const dayRowSchema = z.object({
  settlement_date: z.string(),
  matched_count: z.number().int().nonnegative(),
  matched_kobo: z.number().int().nonnegative(),
  missing_in_ledger_count: z.number().int().nonnegative(),
  missing_in_ledger_kobo: z.number().int().nonnegative(),
  missing_at_paystack_count: z.number().int().nonnegative(),
  missing_at_paystack_kobo: z.number().int().nonnegative(),
  other_break_count: z.number().int().nonnegative(),
  computed_at: z.string(),
});
export type DayRow = z.infer<typeof dayRowSchema>;

export const exceptionRowSchema = z.object({
  break_id: z.string().uuid(),
  tieout_class: z.string(),
  provider_reference: z.string(),
  provider_amount_kobo: z.number().int().nullable(),
  ledger_amount_kobo: z.number().int().nullable(),
  difference_kobo: z.number().int().nullable(),
  detail: z.string().nullable(),
  first_seen_at: z.string(),
  age_hours: z.number().int().nonnegative(),
});
export type ExceptionRow = z.infer<typeof exceptionRowSchema>;

export const dayRowsSchema = z.array(dayRowSchema);
export const exceptionRowsSchema = z.array(exceptionRowSchema);

export function dayExceptions(d: DayRow): number {
  return d.missing_in_ledger_count + d.missing_at_paystack_count + d.other_break_count;
}

export function dayState(d: DayRow): "clean" | "exceptions" | "nothing_compared" {
  if (dayExceptions(d) > 0) return "exceptions";
  return d.matched_count > 0 ? "clean" : "nothing_compared";
}
