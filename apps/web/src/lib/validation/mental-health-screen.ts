import { z } from "zod";

/**
 * Intake mental-health screen (AHC pathway §11): PHQ-9 (9 items), GAD-7
 * (7 items), AUDIT-C (3 items). PHQ-9/GAD-7 items are 0–3; AUDIT-C items are
 * 0–4. Each maps to a stored, structured value — scored server-side by
 * apps/web/src/lib/rules/mental-health-screening.ts, never trusting a
 * client-computed total.
 */

const phqGadItem = z.coerce.number().int().min(0).max(3);
const auditItem = z.coerce.number().int().min(0).max(4);

const phq9Fields = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`phq9_${i + 1}`, phqGadItem])
) as Record<`phq9_${number}`, typeof phqGadItem>;

const gad7Fields = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [`gad7_${i + 1}`, phqGadItem])
) as Record<`gad7_${number}`, typeof phqGadItem>;

const auditcFields = Object.fromEntries(
  Array.from({ length: 3 }, (_, i) => [`auditc_${i + 1}`, auditItem])
) as Record<`auditc_${number}`, typeof auditItem>;

export const mentalHealthScreenSchema = z.object({
  ...phq9Fields,
  ...gad7Fields,
  ...auditcFields,
});

export type MentalHealthScreenInput = z.infer<typeof mentalHealthScreenSchema>;

/** The four PHQ-9 / GAD-7 answer options (frequency over the last 2 weeks). */
export const FREQUENCY_OPTIONS = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "Several days" },
  { value: 2, label: "More than half the days" },
  { value: 3, label: "Nearly every day" },
] as const;

export const PHQ9_QUESTIONS = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "Trouble concentrating on things, such as reading or watching television",
  "Moving or speaking so slowly that other people could have noticed — or being fidgety or restless",
  "Thoughts that you would be better off dead, or of hurting yourself in some way",
] as const;

export const GAD7_QUESTIONS = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
] as const;

/** AUDIT-C — each question has its own 0–4 answer scale. */
export const AUDITC_QUESTIONS = [
  {
    prompt: "How often do you have a drink containing alcohol?",
    options: ["Never", "Monthly or less", "2–4 times a month", "2–3 times a week", "4+ times a week"],
  },
  {
    prompt: "How many drinks do you have on a typical day when drinking?",
    options: ["1–2", "3–4", "5–6", "7–9", "10 or more"],
  },
  {
    prompt: "How often do you have six or more drinks on one occasion?",
    options: ["Never", "Less than monthly", "Monthly", "Weekly", "Daily or almost daily"],
  },
] as const;
