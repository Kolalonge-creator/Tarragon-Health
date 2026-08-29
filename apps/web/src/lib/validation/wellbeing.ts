import { z } from "zod";

/** Module 46 §46.13 — mood/stress/sleep/activity self check-in. A 1–5 scale
 * for each, the same shape a patient can fill in a few taps. */
export const wellbeingCheckinSchema = z.object({
  mood_score: z.coerce.number().int().min(1).max(5),
  stress_score: z.coerce.number().int().min(1).max(5),
  sleep_quality: z.coerce.number().int().min(1).max(5),
  activity_level: z.coerce.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
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
