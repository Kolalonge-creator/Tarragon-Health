import { z } from "zod";
import { predicateSchema } from "./predicate-schema";

/**
 * Structural validation for a risk_questionnaire_configs.config payload
 * (see apps/web/src/lib/rules/risk-questionnaire-engine.ts and
 * apps/web/src/lib/rules/predicate.ts for the shapes this mirrors).
 * Deliberately strict — same reasoning as cv-risk-config.ts's flat-field
 * Zod schema: a malformed config must never reach the engine. The editor
 * here is JSON, not individual form fields (the config's shape — a
 * question bank with branching plus per-condition scoring rules — doesn't
 * reduce to a handful of numeric fields the way CV-risk targets do), so
 * this schema is what stands between free-text JSON and a config a
 * Clinical Director might sign.
 */

const questionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const questionSchema = z.object({
  key: z.string().min(1),
  category: z.enum(["lifestyle", "family_history", "pmh", "meds", "vaccination", "screening_history"]),
  prompt: z.string().min(1),
  help_text: z.string().optional(),
  input_type: z.enum(["boolean", "single_select", "multi_select", "number", "text"]),
  options: z.array(questionOptionSchema).optional(),
  required: z.boolean(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().optional(),
  applicability: predicateSchema.optional(),
  order_index: z.number(),
});

const factorSchema = z.object({
  key: z.string().min(1),
  points: z.number(),
  predicate: predicateSchema,
});

const conditionSchema = z.object({
  condition: z.string().min(1),
  sex_applicability: z.enum(["male", "female"]).nullable(),
  forced_high_predicate: predicateSchema.nullable().optional(),
  moderate_threshold: z.number(),
  high_threshold: z.number(),
  relevant_question_keys: z.array(z.string().min(1)),
  factors: z.array(factorSchema).min(1),
});

export const riskQuestionnaireConfigSchema = z
  .object({
    questions: z.array(questionSchema),
    conditions: z.array(conditionSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const questionKeys = new Set(data.questions.map((q) => q.key));
    if (questionKeys.size !== data.questions.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate question keys are not allowed" });
    }
    for (const [i, condition] of data.conditions.entries()) {
      if (condition.high_threshold < condition.moderate_threshold) {
        ctx.addIssue({
          code: "custom",
          path: ["conditions", i, "high_threshold"],
          message: `${condition.condition}: high_threshold must be >= moderate_threshold`,
        });
      }
    }
  });

export type RiskQuestionnaireConfigFormValues = z.infer<typeof riskQuestionnaireConfigSchema>;

export const riskQuestionnaireConfigJsonSchema = z.object({
  notes: z.string().min(1).max(2000),
  configJson: z.string().min(1).superRefine((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not valid JSON" });
      return;
    }
    const result = riskQuestionnaireConfigSchema.safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        message: result.error.issues[0]?.message ?? "Config does not match the expected shape",
      });
    }
  }),
});
