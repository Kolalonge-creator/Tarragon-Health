import { z } from "zod";
import type { Enums } from "@tarragon/shared";

export const secondOpinionRequestSchema = z.object({
  existingDiagnosisOrResult: z
    .string()
    .trim()
    .min(10, "Describe the result or diagnosis you'd like reviewed")
    .max(2000, "Please keep it under 2,000 characters"),
  sourceDescription: z.string().trim().max(300).optional(),
  specificQuestion: z.string().trim().max(500).optional(),
  // Released lab results the patient chooses to show the doctor. The database re-checks every id.
  sharedLabResultIds: z.array(z.string().uuid()).max(10, "Share at most 10 results").default([]),
});

/** Mirrors the public.specialist_type enum; add a value here when that enum gains one. */
export const SECOND_OPINION_SPECIALIST_TYPES = [
  "urologist",
  "oncologist",
  "ob_gyn",
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "dietetics",
  "podiatry",
  "other",
] as const;

// Typed against the enum itself, so a new specialist_type value is a compile error here until it is labelled or deliberately
// excluded. Mental health and genitourinary medicine referrals have their own dedicated flows and are not offered from a
// second opinion.
export const SPECIALIST_TYPE_LABEL: Record<Exclude<Enums<"specialist_type">, "psychiatry" | "psychology" | "genitourinary_medicine">, string> = {
  urologist: "Urology",
  oncologist: "Oncology",
  ob_gyn: "Obstetrics and gynaecology",
  cardiology: "Cardiology",
  endocrinology: "Endocrinology",
  nephrology: "Nephrology",
  ophthalmology: "Ophthalmology",
  dietetics: "Dietetics",
  podiatry: "Podiatry",
  other: "Other specialist",
};

export const secondOpinionReferralSchema = z.object({
  specialistType: z.enum(SECOND_OPINION_SPECIALIST_TYPES),
  urgency: z.enum(["routine", "priority", "urgent"]),
  reason: z.string().trim().min(10, "A referral needs a reason").max(1000),
  requestedService: z.string().trim().max(300).optional(),
});

export const secondOpinionAnswerSchema = z.object({
  requestId: z.string().uuid(),
  answer: z
    .string()
    .trim()
    .min(10, "The answer needs a little more substance")
    .max(4000),
  referral: secondOpinionReferralSchema.optional(),
});

/** What public.read_second_opinion_audited returns to the doctor. */
export const secondOpinionReadSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  status: z.string(),
  existing_diagnosis_or_result: z.string(),
  source_description: z.string().nullable(),
  specific_question: z.string().nullable(),
  results: z.array(
    z.object({
      id: z.string().uuid(),
      panel_code: z.string().nullable(),
      received_at: z.string(),
      items: z.array(
        z.object({
          analyte_code: z.string(),
          value_numeric: z.number().nullable(),
          value_text: z.string().nullable(),
          unit: z.string(),
          ref_low: z.number().nullable(),
          ref_high: z.number().nullable(),
          flag: z.string(),
        }),
      ),
    }),
  ),
});
export type SecondOpinionRead = z.infer<typeof secondOpinionReadSchema>;
