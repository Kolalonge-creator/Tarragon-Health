import { z } from "zod";
import { MONITORABLE_VITAL_TYPES } from "@/lib/monitoring/templates";

const noteField = z.string().trim().max(500).optional();

/** Raw string from a date input; the server action converts to a real date. */
const dateField = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
    message: "Enter a valid date",
  });

export const monitoringScheduleItemInputSchema = z.object({
  vital_type: z.enum(MONITORABLE_VITAL_TYPES),
  times_per_day: z.coerce
    .number()
    .int()
    .min(1, "At least once a day")
    .max(6, "At most 6 times a day"),
  frequency_days: z.coerce
    .number()
    .int()
    .min(1, "At least every day")
    .max(30, "At most every 30 days"),
  escalation_missed_threshold: z.coerce
    .number()
    .int()
    .min(1, "At least 1 missed reading")
    .max(14, "At most 14 missed readings"),
  acceptable_range: z.record(z.string(), z.number()).optional(),
});
export type MonitoringScheduleItemInput = z.infer<typeof monitoringScheduleItemInputSchema>;

export const startMonitoringEpisodeSchema = z.object({
  patient_id: z.string().uuid(),
  purpose: z.string().trim().min(1, "Give this episode a purpose").max(200),
  condition: z
    .enum(["hypertension", "diabetes", "obesity", "ckd", "cardiovascular", "other"])
    .optional(),
  started_at: dateField,
  duration_days: z.coerce
    .number()
    .int()
    .min(1, "At least 1 day")
    .max(365, "At most 365 days")
    .optional(),
  review_date: dateField,
  tracks_symptoms: z.coerce.boolean().optional(),
  schedule_items: z.array(monitoringScheduleItemInputSchema).min(1, "Add at least one measurement"),
});
export type StartMonitoringEpisodeInput = z.infer<typeof startMonitoringEpisodeSchema>;

export const MONITORING_MISSED_REASONS = [
  "forgot",
  "travelling",
  "device_problem",
  "unwell",
  "no_supplies",
  "other",
] as const;

export const monitoringMissedReasonSchema = z.object({
  schedule_item_id: z.string().uuid(),
  reason: z.enum(MONITORING_MISSED_REASONS),
  note: noteField,
});
export type MonitoringMissedReasonInput = z.infer<typeof monitoringMissedReasonSchema>;
