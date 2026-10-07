import { z } from "zod";

/**
 * A patient opting into an offered screen_types.is_optional screening (e.g.
 * dental_check, ferritin, TFT, vitamin B12) — see useAcceptOptionalScreening.
 * organisationId/patientId are intentionally NOT part of this schema: they
 * come from the caller's own server-verified session context, never from
 * client input, the same trust boundary useLogScreeningCompletion already
 * enforces for organisation_id.
 */
export const acceptOptionalScreeningSchema = z.object({
  screenTypeId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)"),
});
export type AcceptOptionalScreeningInput = z.infer<typeof acceptOptionalScreeningSchema>;
