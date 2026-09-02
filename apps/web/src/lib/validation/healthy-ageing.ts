import { z } from "zod";

const domainOutcome = z.enum(["no_concern", "monitor", "further_assessment_suggested"]);

const domainAnswer = z.object({
  domain: z.enum([
    "mobility",
    "falls",
    "cognition",
    "nutrition",
    "vision",
    "hearing",
    "social_support",
    "functional_independence",
    "frailty",
  ]),
  outcome: domainOutcome,
  note: z.string().trim().max(500).optional(),
});

/** One check-in submission can answer several domains at once — the UI
 * batches whatever the patient/caregiver filled in rather than one round
 * trip per domain. */
export const ageingAssessmentDomainAnswersSchema = z.object({
  answers: z.array(domainAnswer).min(1, "Answer at least one section before saving"),
});
export type AgeingAssessmentDomainAnswersInput = z.infer<typeof ageingAssessmentDomainAnswersSchema>;

export const fallsRiskCheckSchema = z.object({
  previous_falls_12mo: z.boolean().default(false),
  mobility_impairment: z.boolean().default(false),
  high_risk_medications: z.boolean().default(false),
  environmental_hazards: z.boolean().default(false),
  balance_concern: z.boolean().default(false),
});
export type FallsRiskCheckInput = z.infer<typeof fallsRiskCheckSchema>;

export const socialDeterminantsCheckSchema = z.object({
  living_alone: z.boolean().default(false),
  transport_difficulty: z.boolean().default(false),
  financial_barrier: z.boolean().default(false),
  caregiver_limitation: z.boolean().default(false),
  healthcare_access_difficulty: z.boolean().default(false),
});
export type SocialDeterminantsCheckInput = z.infer<typeof socialDeterminantsCheckSchema>;

export const homeCareRequestSchema = z.object({
  reason: z.string().trim().min(1, "Tell us a little about why").max(500),
});
export type HomeCareRequestInput = z.infer<typeof homeCareRequestSchema>;
