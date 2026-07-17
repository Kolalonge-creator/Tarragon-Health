import { z } from "zod";

/**
 * A patient logging a hospital admission. The diagnosis is explicitly
 * self-reported (free text) — it is never treated as a clinical finding.
 * `discharged_on` is optional: omitting it means "still admitted".
 */
export const hospitalAdmissionSchema = z
  .object({
    admitted_on: z.string().min(1, "When were you admitted?"),
    discharged_on: z.string().optional(),
    facility_name: z.string().trim().max(200).optional(),
    self_reported_diagnosis: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine(
    (v) =>
      !v.discharged_on ||
      !v.admitted_on ||
      new Date(v.discharged_on) >= new Date(v.admitted_on),
    { message: "Discharge date can't be before the admission date", path: ["discharged_on"] },
  );
export type HospitalAdmissionInput = z.infer<typeof hospitalAdmissionSchema>;

/** Patient editing their own admission — usually to add the discharge date. */
export const hospitalAdmissionUpdateSchema = z
  .object({
    id: z.string().uuid(),
    discharged_on: z.string().optional(),
    self_reported_diagnosis: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(1000).optional(),
  });
export type HospitalAdmissionUpdateInput = z.infer<typeof hospitalAdmissionUpdateSchema>;
