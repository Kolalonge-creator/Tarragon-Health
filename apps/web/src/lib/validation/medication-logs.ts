import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Pathway §65.9 — the barrier behind a missed dose, structured so the care
 * team can run a targeted intervention instead of a generic reminder. */
export const MISSED_DOSE_REASONS = [
  "cost",
  "side_effects",
  "forgetfulness",
  "availability",
  "understanding",
  "other",
] as const;
export type MissedDoseReason = (typeof MISSED_DOSE_REASONS)[number];

export const medicationLogSchema = z
  .object({
    medication_id: z.string().uuid(),
    status: z.enum(["taken", "missed", "skipped"]),
    reason: z.string().trim().max(500).optional(),
    missed_reason: z.enum(MISSED_DOSE_REASONS).optional(),
    scheduled_time: z.string().regex(HHMM, "Use 24-hour HH:MM, e.g. 08:00").optional(),
    scheduled_for_date: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.scheduled_time) === Boolean(data.scheduled_for_date),
    {
      message: "scheduled_time and scheduled_for_date must both be set, or both omitted",
      path: ["scheduled_time"],
    }
  )
  .refine((data) => !data.missed_reason || data.status === "missed", {
    message: "missed_reason can only be set when status is 'missed'",
    path: ["missed_reason"],
  });
export type MedicationLogInput = z.infer<typeof medicationLogSchema>;
