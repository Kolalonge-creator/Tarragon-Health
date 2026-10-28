/**
 * The one wording source for the label every surface that shows model-generated text must carry
 * (Part C scan rule `ai-label`, S87). Plain words, no jargon. Web renders it through `AiLabel`
 * (`apps/web/src/components/ai/ai-label.tsx`); the phone app renders the same text.
 */
export const AI_LABEL_TEXT = {
  drafted: "Drafted by AI",
  unreviewed: "Drafted by AI, not yet reviewed",
  unfiled: "Drafted by AI, not yet filed",
  questions: "Drafted by AI: questions to consider, not medical advice",
  directory: "Drafted by AI: from our facility directory, not a recommendation",
  explainer: "Drafted by AI: for understanding, not a diagnosis",
  coach: "Written by AI, not by a doctor",
  plan: "Drafted by AI: a starting point, not a prescription",
} as const;

export type AiLabelVariant = keyof typeof AI_LABEL_TEXT;
