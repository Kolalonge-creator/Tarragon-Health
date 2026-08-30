import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MISSED_REASONS = [
  "forgot",
  "device_unavailable",
  "doesnt_understand",
  "doesnt_want_to",
  "feels_well",
  "technical_problem",
] as const;

export const medicationLogSchema = z
  .object({
    medication_id: z.string().uuid(),
    status: z.enum(["taken", "missed", "skipped"]),
    reason: z.string().trim().max(500).optional(),
    missed_reason: z.enum(MISSED_REASONS).optional(),
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
