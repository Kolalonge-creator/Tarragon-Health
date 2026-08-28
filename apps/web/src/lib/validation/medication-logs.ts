import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// 13.5 — clinically distinct adherence signals, not just "taken/missed/skipped".
// unable_to_obtain is the access-non-adherence signal (13.16); vomited and
// side_effect are their own statuses rather than a "missed" + free-text
// reason, so a coach/coordinator worklist can act on them without parsing
// prose; other is the catch-all.
export const medicationLogStatusValues = [
  "taken",
  "missed",
  "skipped",
  "unable_to_obtain",
  "vomited",
  "side_effect",
  "other",
] as const;

export const medicationAccessBarrierReasonValues = [
  "cost",
  "stockout",
  "distance",
  "no_transport",
  "other",
] as const;

export const medicationLogSchema = z
  .object({
    medication_id: z.string().uuid(),
    status: z.enum(medicationLogStatusValues),
    reason: z.string().trim().max(500).optional(),
    // Only meaningful (and only DB-permitted) alongside status='unable_to_obtain'.
    access_barrier_reason: z.enum(medicationAccessBarrierReasonValues).optional(),
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
  .refine((data) => !data.access_barrier_reason || data.status === "unable_to_obtain", {
    message: "access_barrier_reason can only be set when status is unable_to_obtain",
    path: ["access_barrier_reason"],
  });
export type MedicationLogInput = z.infer<typeof medicationLogSchema>;
export type MedicationLogStatus = (typeof medicationLogStatusValues)[number];
export type MedicationAccessBarrierReason = (typeof medicationAccessBarrierReasonValues)[number];
