import type { HealthScoreComponent } from "./health-score";

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
};
