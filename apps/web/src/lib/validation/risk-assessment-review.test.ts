import {
  answersToFormData,
  draftAnswersSchema,
  formDataToAnswers,
  missingAnswers,
  reviewSummary,
  type DraftAnswers,
} from "./risk-assessment-review";

const COMPLETE: DraftAnswers = {
  family_diabetes: "on",
  family_cancer_types: ["breast"],
  smoking_status: "never",
  alcohol_use: "none",
  exercise_days_per_week: "3",
  exercise_minutes_per_session: "30",
  sleep_hours: "7_to_8",
  stress_level: "low",
  height_cm: "170",
  diet_pattern: [],
  existing_diagnoses: ["hypertension"],
};

describe("risk assessment draft answers", () => {
  it("round-trips a form: single fields as text, checkbox groups as lists, blank text left out", () => {
    const fd = new FormData();
    fd.append("smoking_status", "current");
    fd.append("family_cancer_types", "breast");
    fd.append("family_cancer_types", "other");
    fd.append("current_medications", "   ");
    const answers = formDataToAnswers(fd);
    expect(answers).toEqual({ smoking_status: "current", family_cancer_types: ["breast", "other"] });
    expect(answersToFormData(answers).getAll("family_cancer_types")).toEqual(["breast", "other"]);
  });

  it("accepts only form-shaped drafts", () => {
    expect(draftAnswersSchema.safeParse(COMPLETE).success).toBe(true);
    expect(draftAnswersSchema.safeParse({ "bad key!": "x" }).success).toBe(false);
    expect(draftAnswersSchema.safeParse({ note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("missingAnswers (More information needed)", () => {
  it("is empty when everything the server requires is answered", () => {
    expect(missingAnswers(COMPLETE)).toEqual([]);
  });

  it("lists each missing required answer once, with the step that holds it, in step order", () => {
    const rest = { ...COMPLETE };
    delete rest.smoking_status;
    delete rest.height_cm;
    const missing = missingAnswers(rest);
    expect(missing.map((m) => [m.field, m.step])).toEqual([
      ["smoking_status", 2],
      ["height_cm", 2],
    ]);
    expect(missing[0].message).toMatch(/smoking/i);
  });

  it("asks for the cigarettes and the 'other' details only when they apply", () => {
    const missing = missingAnswers({ ...COMPLETE, smoking_status: "current", existing_diagnoses: ["other"] });
    expect(missing.map((m) => m.field).sort()).toEqual(["cigarettes_per_day", "existing_diagnoses_other_detail"]);
  });
});

describe("reviewSummary", () => {
  it("shows the answers by step and leaves the HPV line out when it is not asked", () => {
    const summary = reviewSummary({ ...COMPLETE, hpv_vaccinated: "on" }, { askHpv: false });
    expect(summary.map((s) => s.title)).toEqual(["Family history", "Lifestyle", "Medical history", "Vaccination & screening"]);
    const lifestyle = summary[1].lines;
    expect(lifestyle).toContainEqual({ label: "Height", value: "170 cm" });
    expect(lifestyle).toContainEqual({ label: "Sleep a night", value: "7 to 8" });
    expect(summary[3].lines.map((l) => l.label)).not.toContain("HPV vaccine");
    expect(reviewSummary(COMPLETE, { askHpv: true })[3].lines).toContainEqual({ label: "HPV vaccine", value: "No" });
  });
});
