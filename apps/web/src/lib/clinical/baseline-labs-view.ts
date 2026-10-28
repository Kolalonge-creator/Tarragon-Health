/** What the sign-off panel shows, read from the draft itself so the rule the CMO signs is the rule that will apply. */
export type BaselineRulesView = {
  classes: { label: string; tests: string }[];
  thresholds: string[];
  notes: string[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const TEST_WORDS: Record<string, string> = {
  creatinine: "creatinine with eGFR",
  potassium: "potassium",
  sodium: "sodium",
  hba1c: "HbA1c",
  fasting_glucose: "fasting glucose",
  glucose_or_hba1c: "fasting glucose or HbA1c",
};

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then shows nothing rather than guess). */
export function baselineRulesView(config: unknown): BaselineRulesView | null {
  if (!isObj(config) || !isObj(config.classes) || !isObj(config.egfr) || !isObj(config.pregnancy) || !isObj(config.notes)) return null;
  const months = config.freshness_months;
  const due = config.tests_due_days;
  const noStart = config.egfr.metformin_do_not_start_below;
  const review = config.egfr.metformin_review_dose_below;
  const pregClasses = config.pregnancy.classes;
  const ageFrom = config.pregnancy.age_from;
  const ageTo = config.pregnancy.age_to;
  if (typeof months !== "number" || typeof due !== "number" || typeof noStart !== "number" || typeof review !== "number" || !Array.isArray(pregClasses) || typeof ageFrom !== "number" || typeof ageTo !== "number") return null;
  const classes: BaselineRulesView["classes"] = [];
  for (const c of Object.values(config.classes)) {
    if (!isObj(c) || typeof c.label !== "string" || !Array.isArray(c.requires)) return null;
    const tests = c.requires.map((r) => (typeof r === "string" ? (TEST_WORDS[r] ?? r) : "?"));
    classes.push({ label: c.label, tests: tests.length === 0 ? "no blood test required" : tests.join(", ") });
  }
  const notes = Object.values(config.notes).filter((n): n is string => typeof n === "string");
  return {
    classes,
    thresholds: [
      `A result counts if it was filed in the last ${months} months. A picture or an unfiled draft counts as missing.`,
      `Without the results the doctor gives a reason to start, and the tests are due within ${due} days.`,
      `Metformin: do not start if eGFR is under ${noStart} (no override); review the dose if under ${review}.`,
      `Women aged ${ageFrom} to ${ageTo} on ${pregClasses.join(", ")}: a recent negative pregnancy test, or the doctor records that pregnancy is excluded.`,
      "Where HbA1c is unreliable (marked by the doctor), fasting glucose is accepted in its place.",
    ],
    notes,
  };
}
