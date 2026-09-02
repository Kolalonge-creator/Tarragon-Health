import { z } from "zod";

/**
 * Zod schemas for everything the governance layer reads back out of the
 * database. `public.ai_runtime_config()` returns jsonb, so it arrives as
 * `Json` and is parsed here rather than cast — a governance record that has
 * drifted from what the runtime expects must be a visible parse failure
 * (which falls back to the code's own behaviour), not a silent `undefined`
 * that reads as "no guardrails".
 */

export const AI_RISK_CLASSES = ["low", "moderate", "high", "very_high"] as const;
export const AI_AUTONOMY_LEVELS = ["inform_only", "recommend", "assist", "execute"] as const;
export const AI_SAFETY_CLASSIFICATIONS = [
  "routine",
  "clinician_review",
  "urgent_escalation",
  "emergency",
] as const;
export const AI_INTERACTION_STATUSES = ["completed", "blocked", "fallback", "failed"] as const;
export const AI_OUTPUT_FLAGS = [
  "unsupported_claim",
  "incorrect_medical_information",
  "fabricated_citation",
  "inappropriate_recommendation",
  "out_of_scope_population",
  "guardrail_bypass_attempt",
] as const;
export const AI_INCIDENT_CATEGORIES = [
  "incorrect_information",
  "unsupported_claim",
  "fabricated_citation",
  "inappropriate_recommendation",
  "missed_escalation",
  "guardrail_bypass",
  "privacy_concern",
  "availability_failure",
  "unexpected_model_change",
  "other",
] as const;

export type AiRiskClass = (typeof AI_RISK_CLASSES)[number];
export type AiAutonomyLevel = (typeof AI_AUTONOMY_LEVELS)[number];
export type AiSafetyClassification = (typeof AI_SAFETY_CLASSIFICATIONS)[number];
export type AiInteractionStatus = (typeof AI_INTERACTION_STATUSES)[number];
export type AiOutputFlag = (typeof AI_OUTPUT_FLAGS)[number];
export type AiIncidentCategory = (typeof AI_INCIDENT_CATEGORIES)[number];

export const aiGuardrailSchema = z.object({
  rule_code: z.string(),
  kind: z.enum([
    "prohibited_diagnosis",
    "prohibited_prescribing",
    "emergency_escalation",
    "population_restriction",
    "max_autonomy",
    "mandatory_human_review",
    "output_constraint",
    "prohibited_topic",
  ]),
  description: z.string(),
  enforcement: z.enum(["blocking", "escalate", "warn"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export type AiGuardrail = z.infer<typeof aiGuardrailSchema>;

export const aiGovernedPromptSchema = z.object({
  prompt_version_id: z.string(),
  version: z.number(),
  system_prompt: z.string(),
  safety_instructions: z.string(),
  retrieval_config: z.record(z.string(), z.unknown()).default({}),
  output_constraints: z.record(z.string(), z.unknown()).default({}),
  model_config: z.record(z.string(), z.unknown()).default({}),
});

export type AiGovernedPrompt = z.infer<typeof aiGovernedPromptSchema>;

export const aiKnowledgeSourceSchema = z.object({
  id: z.string(),
  source_code: z.string(),
  title: z.string(),
  source_type: z.string(),
  citation_label: z.string(),
  reference_table: z.string().nullable(),
  reference_id: z.string().nullable(),
});

export type AiKnowledgeSource = z.infer<typeof aiKnowledgeSourceSchema>;

/** The shape `public.ai_runtime_config()` returns for a registered system. */
export const aiRuntimeConfigSchema = z.object({
  registered: z.literal(true),
  system_code: z.string(),
  system_id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /**
   * Whether the running code for this system actually consults governance.
   * Defaulted rather than required so a deploy that is briefly ahead of its
   * migration still parses — the safe reading of a missing value is "we
   * cannot claim this is governed".
   */
  runtime_governed: z.boolean().default(false),
  lifecycle_status: z.string(),
  risk_class: z.enum(AI_RISK_CLASSES),
  autonomy_level: z.enum(AI_AUTONOMY_LEVELS),
  clinically_meaningful: z.boolean(),
  fallback_behaviour: z.string(),
  disabled_reason: z.string().nullable(),
  expected_model_identifier: z.string().nullable(),
  prompt: aiGovernedPromptSchema.nullable(),
  guardrails: z.array(aiGuardrailSchema),
  knowledge_sources: z.array(aiKnowledgeSourceSchema),
});

export type AiRuntimeConfig = z.infer<typeof aiRuntimeConfigSchema>;

/** ...and for one the registry has never heard of. */
export const aiUnregisteredConfigSchema = z.object({
  registered: z.literal(false),
  system_code: z.string(),
});

export const aiRuntimeConfigResponseSchema = z.union([
  aiRuntimeConfigSchema,
  aiUnregisteredConfigSchema,
]);

/**
 * Why a call was not allowed to reach the model. Each maps to a different
 * operational response, which is why they are not collapsed into one
 * "unavailable":
 *
 *  - kill_switch          a human deliberately switched this system off (40.17)
 *  - unregistered         the call site is not in the registry — a wiring gap
 *  - governance_unavailable  the registry could not be read, and this system
 *                            fails closed
 */
export type AiBlockReason = "kill_switch" | "unregistered" | "governance_unavailable";

export type AiGovernanceDecision =
  | { readonly allow: true; readonly config: AiRuntimeConfig | null; readonly degraded: boolean }
  | {
      readonly allow: false;
      readonly reason: AiBlockReason;
      readonly config: AiRuntimeConfig | null;
      readonly message: string;
    };
