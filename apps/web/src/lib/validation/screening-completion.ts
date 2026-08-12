import { z } from "zod";
import { todayIsoDate } from "@/lib/queries/medications";

/** A patient confirming a due screening was done, and on which date — the
 * next cycle is scheduled from this date, not from today and not a fixed
 * calendar cadence (see private.refresh_screening_schedule_on_completion). */
export const logScreeningCompletionSchema = z.object({
  screen_type_id: z.string().uuid(),
  schedule_id: z.string().uuid().optional(),
  performed_date: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date" })
    .refine((value) => value <= todayIsoDate(), { message: "That date can't be in the future" }),
  note: z.string().trim().max(500).optional(),
});
export type LogScreeningCompletionInput = z.infer<typeof logScreeningCompletionSchema>;
