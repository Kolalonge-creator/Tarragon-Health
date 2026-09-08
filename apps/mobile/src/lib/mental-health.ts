import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

// --- Content ported verbatim from apps/web/src/lib/validation/
// mental-health-screen.ts (PHQ-9/GAD-7/AUDIT-C/EPDS instrument text) and
// lib/rules/mental-health-screening.ts (band labels). Scoring/crisis
// detection is NOT ported — that stays server-side, see api.ts's
// postMentalHealthScreen, which calls the exact same server logic web uses.

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

export const PHQ9_BAND_LABEL: Record<string, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  moderately_severe: "Moderately severe",
  severe: "Severe",
};
export const GAD7_BAND_LABEL: Record<string, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
export const AUDITC_BAND_LABEL: Record<string, string> = {
  low_risk: "Lower risk",
  increasing_risk: "Increasing risk",
  higher_risk: "Higher risk",
};
export const EPDS_BAND_LABEL: Record<string, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

export type MentalHealthScreen = Tables<"mental_health_screens">;

/** Mirrors apps/web/src/lib/queries/mental-health.ts's
 * useLatestMentalHealthScreens — a plain RLS-scoped read, safe directly. */
export async function loadLatestMentalHealthScreens(
  patientId: string
): Promise<Partial<Record<string, MentalHealthScreen>>> {
  const { data } = await supabase
    .from("mental_health_screens")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  const latest: Partial<Record<string, MentalHealthScreen>> = {};
  for (const row of data ?? []) {
    if (!(row.instrument in latest)) latest[row.instrument] = row;
  }
  return latest;
}
