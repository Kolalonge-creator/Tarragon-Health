import { z } from "zod";

/**
 * STI risk/symptom check (spec §47.3's "risk assessment -> testing
 * recommendation/pathway"). Short, warm, non-clinical framing — the patient
 * is never told a number or a verdict, just what's worth getting checked.
 * Scored server-side by apps/web/src/lib/rules/sti-risk-assessment.ts, never
 * trusting a client-computed level (same discipline as
 * lib/validation/mental-health-screen.ts / lib/rules/mental-health-screening.ts).
 *
 * `sexually_active_12mo` gates everything else: the remaining fields are
 * shown (and required) only when it's true. Booleans follow this codebase's
 * existing plain-checkbox convention (see family_diabetes etc. in
 * lib/validation/risk-assessment.ts) — unticked reads as "no", same as every
 * other yes/no checkbox on the platform.
 */

export const STI_PARTNER_COUNTS = ["0", "1", "2_4", "5_plus"] as const;
export type StiPartnerCount = (typeof STI_PARTNER_COUNTS)[number];

export const STI_PARTNER_COUNT_LABEL: Record<StiPartnerCount, string> = {
  "0": "None",
  "1": "One",
  "2_4": "Two to four",
  "5_plus": "Five or more",
};

export const STI_CONDOM_USES = ["always", "sometimes", "never"] as const;
export type StiCondomUse = (typeof STI_CONDOM_USES)[number];

export const STI_CONDOM_USE_LABEL: Record<StiCondomUse, string> = {
  always: "Always",
  sometimes: "Sometimes",
  never: "Rarely or never",
};

export const STI_SYMPTOMS = [
  "discharge",
  "genital_sores",
  "pain_urination",
  "pelvic_pain",
  "pain_during_sex",
  "none",
] as const;
export type StiSymptom = (typeof STI_SYMPTOMS)[number];

export const STI_SYMPTOM_LABEL: Record<StiSymptom, string> = {
  discharge: "Unusual discharge",
  genital_sores: "Sores, bumps, or blisters",
  pain_urination: "Pain or burning when you pee",
  pelvic_pain: "Pelvic or lower belly pain",
  pain_during_sex: "Pain during sex",
  none: "None of these",
};

export const stiRiskCheckSchema = z
  .object({
    sexually_active_12mo: z.coerce.boolean(),
    new_partner_3mo: z.coerce.boolean(),
    partner_count_12mo: z.enum(STI_PARTNER_COUNTS).optional(),
    condom_use: z.enum(STI_CONDOM_USES).optional(),
    symptoms: z.array(z.enum(STI_SYMPTOMS)).default([]),
    prior_sti_diagnosis: z.coerce.boolean(),
    partner_diagnosed_sti: z.coerce.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.symptoms.includes("none") && data.symptoms.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["symptoms"],
        message: '"None of these" can\'t be combined with another symptom',
      });
    }

    // Everything past this point only applies once the patient tells us
    // they've been sexually active in the last 12 months.
    if (!data.sexually_active_12mo) return;

    if (!data.partner_count_12mo) {
      ctx.addIssue({
        code: "custom",
        path: ["partner_count_12mo"],
        message: "Let us know roughly how many partners",
      });
    }
    if (!data.condom_use) {
      ctx.addIssue({
        code: "custom",
        path: ["condom_use"],
        message: "Let us know about condom use",
      });
    }
    if (data.symptoms.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["symptoms"],
        message: 'Choose anything that applies, or "None of these"',
      });
    }
  });

export type StiRiskCheckInput = z.infer<typeof stiRiskCheckSchema>;
