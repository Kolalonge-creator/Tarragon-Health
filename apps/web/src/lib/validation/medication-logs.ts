import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fixed vocabulary for why a dose was missed/skipped, alongside the existing
 * free-text `reason` — see 20260826213713_medication_logs_reason_codes_and_
 * unconfirmed_status.sql for the DB-side CHECK this must stay in sync with.
 * 'felt_fine' is the one deliberate-skip code (mapped to status='skipped' by
 * the caller, todays-doses.tsx); every other code implies status='missed'. */
export const MEDICATION_LOG_REASON_CODES = [
  "ran_out",
  "side_effects",
  "felt_fine",
  "forgot",
  "cost",
  "other",
] as const;
export type MedicationLogReasonCode = (typeof MEDICATION_LOG_REASON_CODES)[number];

export const medicationLogSchema = z
  .object({
    medication_id: z.string().uuid(),
    status: z.enum(["taken", "missed", "skipped"]),
    reason: z.string().trim().max(500).optional(),
    reason_code: z.enum(MEDICATION_LOG_REASON_CODES).optional(),
    scheduled_time: z.string().regex(HHMM, "Use 24-hour HH:MM, e.g. 08:00").optional(),
    scheduled_for_date: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.scheduled_time) === Boolean(data.scheduled_for_date),
    {
      message: "scheduled_time and scheduled_for_date must both be set, or both omitted",
      path: ["scheduled_time"],
    }
  );
export type MedicationLogInput = z.infer<typeof medicationLogSchema>;
