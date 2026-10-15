import { z } from "zod";
import { WELLBEING_TAGS, MAX_WELLBEING_TAGS } from "@tarragon/shared";
import { en, t, type MessageKey } from "@tarragon/i18n";

/** Module 46 §46.13 — mood/stress/sleep/activity self check-in. A 1–5 scale
 * for each, the same shape a patient can fill in a few taps. */
export const wellbeingCheckinSchema = z.object({
  mood_score: z.coerce.number().int().min(1).max(5),
  stress_score: z.coerce.number().int().min(1).max(5),
  sleep_quality: z.coerce.number().int().min(1).max(5),
  activity_level: z.coerce.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
  /** Optional context from a fixed list (S56, 10.1). Never free text; at most six. */
  tags: z.array(z.enum(WELLBEING_TAGS)).max(MAX_WELLBEING_TAGS).default([]),
});

export type WellbeingCheckinInput = z.infer<typeof wellbeingCheckinSchema>;

export const wellbeingReminderFrequencySchema = z.object({
  reminder_frequency_days: z.coerce.number().int().min(1).max(90),
});

export const WELLBEING_SCALE_QUESTIONS = [
  { name: "mood_score" as const, prompt: "How has your mood been?", low: "Struggling", high: "Great" },
  { name: "stress_score" as const, prompt: "How stressed have you felt?", low: "Calm", high: "Very stressed" },
  { name: "sleep_quality" as const, prompt: "How has your sleep been?", low: "Poor", high: "Great" },
  { name: "activity_level" as const, prompt: "How active have you been?", low: "Not at all", high: "Very active" },
] as const;

/** Display copy for each tag (from the i18n catalogue, namespace mood). */
export function wellbeingTagLabel(tag: string): string {
  const key = `mood.tag.${tag}` as MessageKey;
  return key in en ? t(key) : tag;
}
