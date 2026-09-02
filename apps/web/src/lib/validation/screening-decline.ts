import { z } from "zod";

/** A patient declining a recommended screening (screening_status 'declined').
 * A reason is required — screening_schedules_declined_requires_reason
 * enforces the same rule at the DB layer, this just gives the patient a
 * clear message before the round trip. */
export const declineScreeningSchema = z.object({
  schedule_id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Let your care team know why, so they can follow up if needed")
    .max(500),
});
export type DeclineScreeningInput = z.infer<typeof declineScreeningSchema>;
