import { z } from "zod";

/**
 * Submitting a pre-procedure safety questionnaire (spec §59.6). `questions`
 * snapshots the exact question set asked for this template_key (versioned —
 * the set genuinely varies by modality, e.g. MRI implant questions vs. a
 * contrast CT's renal-function questions — see the template catalogue in
 * imaging-safety-questionnaires/templates.ts), `answers` is a free-form
 * record keyed by question id. has_contraindication/contraindication_notes
 * are the APP's own scoring of those answers against the template's rules
 * (see the DB migration header: "the DB's job is safe storage + the review/
 * alert loop, not re-implementing per-modality clinical logic in SQL") —
 * computed before this reaches the server action, not re-derived here.
 */
export const submitImagingSafetyQuestionnaireSchema = z.object({
  imaging_order_id: z.string().uuid(),
  template_key: z.string().trim().min(1).max(100),
  questions: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
    })
  ),
  answers: z.record(z.string(), z.union([z.boolean(), z.string()])),
  has_contraindication: z.boolean(),
  contraindication_notes: z.string().trim().max(2000).optional(),
});
export type SubmitImagingSafetyQuestionnaireInput = z.infer<
  typeof submitImagingSafetyQuestionnaireSchema
>;
