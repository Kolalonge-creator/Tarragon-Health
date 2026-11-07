import { z } from "zod";
import { FIELD_STEP, parseRiskAssessmentFormData, riskAssessmentSchema } from "./risk-assessment";

/**
 * P14: the pieces of the risk assessment's "save and resume" and "check your answers" steps that are plain data, so they
 * can be tested without a browser. A draft is the form's own fields by name (a ticked checkbox is "on", a group of
 * checkboxes is a list), never anything the rules engine reads: only a submitted assessment counts.
 */

export type DraftAnswers = Record<string, string | string[]>;

/** What a saved draft may hold: the form's field names and short values, nothing else. */
export const draftAnswersSchema = z
  .record(z.string().regex(/^[a-z_]{1,60}$/), z.union([z.string().max(500), z.array(z.string().max(60)).max(20)]))
  .refine((o) => Object.keys(o).length <= 40, "Too many answers");

export const saveDraftInputSchema = z.object({
  answers: draftAnswersSchema,
  step: z.number().int().min(1).max(5),
});

/** The fields of a form, as a draft. Blank text is left out, so a blank answer is never saved as a value. */
export function formDataToAnswers(formData: FormData): DraftAnswers {
  const out: DraftAnswers = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    if (MULTI_FIELDS.has(key)) {
      out[key] = values;
    } else if (values[0] !== undefined && values[0].trim() !== "") {
      out[key] = values[0];
    }
  }
  return out;
}

export function answersToFormData(answers: DraftAnswers): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(answers)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}

/** The checkbox groups (several values under one name). */
export const MULTI_FIELDS = new Set(["family_cancer_types", "diet_pattern", "existing_diagnoses"]);

export type MissingAnswer = { field: string; step: number; message: string };

/**
 * The answers the assessment still needs before it can be submitted ("More information needed"), with the step each
 * one is on. Uses the same schema the server checks on submit, so the two can never disagree.
 */
export function missingAnswers(answers: DraftAnswers): MissingAnswer[] {
  const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(answersToFormData(answers)));
  if (parsed.success) return [];
  const seen = new Set<string>();
  const out: MissingAnswer[] = [];
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (!field || seen.has(field)) continue;
    seen.add(field);
    out.push({ field, step: FIELD_STEP[field] ?? 1, message: issue.message });
  }
  return out.sort((a, b) => a.step - b.step);
}

const words = (v: string) => v.replace(/_/g, " ");

type Line = { label: string; field: string; show: (a: DraftAnswers) => string | null };

const tick = (field: string, label: string): Line => ({ field, label, show: (a) => (a[field] ? "Yes" : "No") });
const text = (field: string, label: string, suffix = ""): Line => ({
  field,
  label,
  show: (a) => {
    const v = a[field];
    return typeof v === "string" && v.trim() ? `${words(v)}${suffix}` : null;
  },
});
const list = (field: string, label: string, none: string): Line => ({
  field,
  label,
  show: (a) => {
    const v = a[field];
    return Array.isArray(v) && v.length > 0 ? v.map(words).join(", ") : none;
  },
});

export const REVIEW_STEPS: { step: number; title: string; lines: Line[] }[] = [
  {
    step: 1,
    title: "Family history",
    lines: [
      tick("family_diabetes", "Diabetes in the family"),
      tick("family_hypertension", "Hypertension in the family"),
      tick("family_heart_disease", "Heart disease in the family"),
      tick("family_sickle_cell", "Sickle cell in the family"),
      list("family_cancer_types", "Cancer in the family", "None"),
      text("family_cancer_other_detail", "Other cancer type"),
    ],
  },
  {
    step: 2,
    title: "Lifestyle",
    lines: [
      text("smoking_status", "Smoking"),
      text("cigarettes_per_day", "Cigarettes per day"),
      text("alcohol_use", "Alcohol"),
      text("exercise_days_per_week", "Exercise days a week"),
      text("exercise_minutes_per_session", "Minutes each time"),
      text("sleep_hours", "Sleep a night"),
      text("stress_level", "Stress level"),
      text("height_cm", "Height", " cm"),
      text("weight_kg", "Weight", " kg"),
      list("diet_pattern", "Diet", "Not given"),
    ],
  },
  {
    step: 3,
    title: "Medical history",
    lines: [
      list("existing_diagnoses", "Existing diagnoses", "None"),
      text("existing_diagnoses_other_detail", "Other diagnosis"),
      text("current_medications", "Current medications"),
    ],
  },
  {
    step: 4,
    title: "Vaccination & screening",
    lines: [
      tick("hpv_vaccinated", "HPV vaccine"),
      text("other_vaccines_detail", "Other vaccines"),
      tick("prior_abnormal_result", "An abnormal screening result before"),
    ],
  },
];

/** The answers, step by step, as label and value. A text answer left blank is not listed (a missing required one is in missingAnswers). */
export function reviewSummary(answers: DraftAnswers, opts: { askHpv: boolean }) {
  return REVIEW_STEPS.map(({ step, title, lines }) => ({
    step,
    title,
    lines: lines
      .filter((l) => opts.askHpv || l.field !== "hpv_vaccinated")
      .map((l) => ({ label: l.label, value: l.show(answers) }))
      .filter((l): l is { label: string; value: string } => l.value !== null),
  }));
}
