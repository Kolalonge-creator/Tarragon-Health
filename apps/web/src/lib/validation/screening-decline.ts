import { z } from "zod";

export const SCREENING_REASON_CODES = [
  "already_done_elsewhere",
  "not_relevant_to_me",
  "medical_reason",
  "cost",
  "prefer_not_to_say",
  "other",
] as const;

/**
 * A patient closing a recommended screening as declined or not applicable. A reason code and a note are both required: the
 * database (screening_schedules_declined_requires_reason, screening_schedules_not_applicable_requires_reason and set_screening_state)
 * enforces the same rule, this just gives the patient a clear message before the round trip.
 */
export const screeningStateSchema = z.object({
  schedule_id: z.string().uuid(),
  state: z.enum(["declined", "not_applicable"]),
  reason_code: z.enum(SCREENING_REASON_CODES),
  note: z.string().trim().min(1, "Let your care team know why, so they can follow up if needed").max(500),
});
export type ScreeningStateInput = z.infer<typeof screeningStateSchema>;

/** Kept for older callers: declining is the same call with state fixed. */
export const declineScreeningSchema = screeningStateSchema
  .pick({ schedule_id: true })
  .extend({ reason: screeningStateSchema.shape.note });
export type DeclineScreeningInput = z.infer<typeof declineScreeningSchema>;
