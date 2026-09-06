import { z } from "zod";

/**
 * Intake mental-health screen (AHC pathway §11; Module 46 §46.3): PHQ-9
 * (9 items), GAD-7 (7 items), AUDIT-C (3 items), and — only when the patient
 * self-identifies as pregnant or within 12 months postpartum — EPDS
 * (10 items). PHQ-9/GAD-7/EPDS items are 0–3; AUDIT-C items are 0–4. Each
 * maps to a stored, structured value — scored server-side by
 * apps/web/src/lib/rules/mental-health-screening.ts, never trusting a
 * client-computed total. EPDS fields are optional here (perinatal status is
 * self-reported, not everyone answers them) and validated as a complete set
 * server-side only when the patient opted in.
 */

const phqGadItem = z.coerce.number().int().min(0).max(3);
const auditItem = z.coerce.number().int().min(0).max(4);
const optionalEpdsItem = z.coerce.number().int().min(0).max(3).optional();

const phq9Fields = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`phq9_${i + 1}`, phqGadItem])
) as Record<`phq9_${number}`, typeof phqGadItem>;

const gad7Fields = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [`gad7_${i + 1}`, phqGadItem])
) as Record<`gad7_${number}`, typeof phqGadItem>;

const auditcFields = Object.fromEntries(
  Array.from({ length: 3 }, (_, i) => [`auditc_${i + 1}`, auditItem])
) as Record<`auditc_${number}`, typeof auditItem>;

const epdsFields = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`epds_${i + 1}`, optionalEpdsItem])
) as Record<`epds_${number}`, typeof optionalEpdsItem>;

export const mentalHealthScreenSchema = z.object({
  ...phq9Fields,
  ...gad7Fields,
  ...auditcFields,
  ...epdsFields,
  is_perinatal: z.coerce.boolean().optional(),
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

/**
 * EPDS (Edinburgh Postnatal Depression Scale) — §46.3 "postnatal mental
 * health". Offered only when the patient self-identifies as pregnant or
 * within 12 months postpartum, alongside (never instead of) PHQ-9/GAD-7/
 * AUDIT-C. Asks about the past 7 days, not 2 weeks. Each question has its
 * own answer scale, ordered here from least (0) to most (3) symptomatic to
 * match the codebase's option[value]-order convention (AUDIT-C above) —
 * standard EPDS content, item 10 is the self-harm question.
 */
export const EPDS_QUESTIONS = [
  {
    prompt: "I have been able to laugh and see the funny side of things",
    options: ["As much as I always could", "Not quite so much now", "Definitely not so much now", "Not at all"],
  },
  {
    prompt: "I have looked forward with enjoyment to things",
    options: ["As much as I ever did", "Rather less than I used to", "Definitely less than I used to", "Hardly at all"],
  },
  {
    prompt: "I have blamed myself unnecessarily when things went wrong",
    options: ["No, never", "Not very often", "Yes, some of the time", "Yes, most of the time"],
  },
  {
    prompt: "I have been anxious or worried for no good reason",
    options: ["No, not at all", "Hardly ever", "Yes, sometimes", "Yes, very often"],
  },
  {
    prompt: "I have felt scared or panicky for no very good reason",
    options: ["No, not at all", "No, not much", "Yes, sometimes", "Yes, quite a lot"],
  },
  {
    prompt: "Things have been getting on top of me",
    options: [
      "No, I have been coping as well as ever",
      "No, most of the time I have coped quite well",
      "Yes, sometimes I haven't been coping as well as usual",
      "Yes, most of the time I haven't been able to cope at all",
    ],
  },
  {
    prompt: "I have been so unhappy that I have had difficulty sleeping",
    options: ["No, not at all", "Not very often", "Yes, sometimes", "Yes, most of the time"],
  },
  {
    prompt: "I have felt sad or miserable",
    options: ["No, not at all", "Not very often", "Yes, quite often", "Yes, most of the time"],
  },
  {
    prompt: "I have been so unhappy that I have been crying",
    options: ["No, never", "Only occasionally", "Yes, quite often", "Yes, most of the time"],
  },
  {
    prompt: "The thought of harming myself has occurred to me",
    options: ["Never", "Hardly ever", "Sometimes", "Yes, quite often"],
  },
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
