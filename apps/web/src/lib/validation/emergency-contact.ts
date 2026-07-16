import { z } from "zod";

// E.164 — same pattern/message used across the app (facility-admin, employer-roster).
const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, "Use E.164 format, e.g. +2348012345678");

/**
 * The patient's emergency contact + next of kin. Stored on `profiles`.
 *
 * All fields are optional so a patient can save what they have and a blank
 * field clears that part — mirrors patientLocationSchema. The emergency-contact
 * phone is what the acknowledge-gated auto-notify messages if the patient does
 * not respond to an active emergency; without it, nothing can be sent (never
 * inferred). When a phone is provided it must be valid E.164.
 */
export const emergencyContactSchema = z
  .object({
    emergency_contact_name: z.string().trim().max(120).optional(),
    emergency_contact_phone: z.union([e164, z.literal("")]).optional(),
    emergency_contact_relationship: z.string().trim().max(60).optional(),
    // The patient must confirm their emergency contact has agreed to be
    // contacted before we ever message them.
    emergency_contact_consent: z.boolean().default(false),
    next_of_kin_name: z.string().trim().max(120).optional(),
    next_of_kin_phone: z.union([e164, z.literal("")]).optional(),
  })
  .refine(
    (data) =>
      !(data.emergency_contact_phone && data.emergency_contact_phone.length > 0) ||
      data.emergency_contact_consent,
    {
      message:
        "Please confirm your emergency contact has agreed to be contacted in an emergency.",
      path: ["emergency_contact_consent"],
    }
  );

export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
