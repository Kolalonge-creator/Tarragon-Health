import type { HealthScoreComponent, HealthScoreComponentKey } from "./health-score";

/** Shared display label per Health Score component, used by every surface that shows
 * the component breakdown (health-score-card.tsx, biological-age-card.tsx, and the
 * Health Score trend page) so the wording can't drift between them. */
export const HEALTH_SCORE_COMPONENT_LABEL: Record<HealthScoreComponent["key"], string> = {
  bp_control: "Blood pressure",
  hba1c: "HbA1c",
  screening_compliance: "Screening",
  vaccination: "Vaccinations",
  bmi: "Weight (BMI)",
  smoking: "Smoking",
  biomarker_heart: "Heart panel",
  biomarker_kidney: "Kidney panel",
  biomarker_liver: "Liver panel",
};

/**
 * Where a patient actually goes to affect each component — the real current
 * write path for that data, not just the intuitively-named page. Verified
 * 2026-09-14 against assess-health-score.ts's own fetchers, since at least
 * one component (smoking) has a real, pre-existing split between an
 * intuitive page and its actual data source: /patient/smoking writes to
 * patient_smoking_profiles, a table health-score.ts's fetchSmoking() never
 * reads — the score only moves via the risk-assessment questions on
 * /patient/prevention. Routing "Smoking" here to /patient/smoking would
 * send a patient somewhere that visibly does nothing to this score. That
 * data-source split is a pre-existing gap worth fixing on its own, not
 * papered over by a link choice — see the follow-up flagged in this PR.
 */
export const HEALTH_SCORE_COMPONENT_HREF: Record<HealthScoreComponentKey, string> = {
  bp_control: "/patient/vitals",
  hba1c: "/patient/labs",
  screening_compliance: "/patient/prevention#screenings",
  vaccination: "/patient/prevention#vaccinations",
  bmi: "/patient/vitals",
  smoking: "/patient/prevention#risk-assessment",
  biomarker_heart: "/patient/labs",
  biomarker_kidney: "/patient/labs",
  biomarker_liver: "/patient/labs",
};

/** Declaration order doubles as display order for the full "what's behind
 * your score" breakdown (health-score-component-grid.tsx) — every possible
 * component, not just the ones the patient already has data for, so the
 * grid can show "not started yet" tiles for the rest rather than silently
 * omitting them. */
export const ALL_HEALTH_SCORE_COMPONENT_KEYS: HealthScoreComponentKey[] = [
  "bp_control",
  "bmi",
  "hba1c",
  "biomarker_heart",
  "biomarker_kidney",
  "biomarker_liver",
  "screening_compliance",
  "vaccination",
  "smoking",
];
