import { formatHba1cWithBracket } from "./hba1c-bracket";

/**
 * Health Score v1 — rule-based/weighted-sum per docs/FULL_SPECIFICATION_V4.md
 * §7 ("app/models/health_score.py ... v1 can be rule-based/weighted-sum
 * before any ML is needed") and §8 ("Health Score v1 (rule-based, not ML) —
 * computed alongside the existing risk scores, Sprint 4"). Built entirely in
 * TypeScript, not services/ml — Sprint 4 (the Python ML microservice) is
 * paused per CLAUDE.md's Current Sprint, and this doesn't need it: every
 * input here is already computable from existing Postgres tables with plain
 * rules, matching the same "rule-based, not black-box" philosophy as
 * lib/rules/risk-scoring.ts.
 *
 * A 0–100 non-diagnostic score (docs/FEATURE_SPEC.md's free-tier "weekly
 * non-diagnostic health score"), combining up to five components. Each
 * component is scored only when its underlying data exists — a patient
 * with no lab-drawn HbA1c (most non-diabetics) isn't penalised for missing
 * data; the other components' weights are redistributed to fill 100.
 *
 * Heart Age / Metabolic Age (mentioned in the spec as optional additions
 * inspired by Hello Heart) are deliberately out of v1 scope — presenting a
 * derived "age" is a stronger patient-facing clinical claim than a 0–100
 * score and deserves its own sign-off, not a drive-by addition here.
 */

export type HealthScoreRiskLevel = "low" | "moderate" | "high" | "very_high";

export interface HealthScoreInputs {
  /** % of blood_pressure readings in the trailing window under 140/90. Null if no readings. */
  bpControlPercent: number | null;
  /** Most recent HbA1c value (%). Null if never lab-tested. */
  latestHba1cPercent: number | null;
  /** % of already-due screenings completed rather than overdue. Null if none due yet. */
  screeningCompliancePercent: number | null;
  /** Null if height or weight is missing. */
  bmi: number | null;
  smokingStatus: "never" | "former" | "current" | null;
  cigarettesPerDay: "1_5" | "6_10" | "11_20" | "20_plus" | null;
}

export interface HealthScoreComponent {
  key: "bp_control" | "hba1c" | "screening_compliance" | "bmi" | "smoking";
  /** 0–100 sub-score for this component alone. */
  value: number;
  /** Weight actually used (redistributed if some components are unavailable). */
  weight: number;
  /** Real-world value alongside the 0-100 sub-score, e.g. "5.9% (Prediabetic range)" for hba1c. */
  detail?: string;
}

export interface ComputedHealthScore {
  score: number;
  riskLevel: HealthScoreRiskLevel;
  components: HealthScoreComponent[];
}

const BASE_WEIGHTS = {
  bp_control: 25,
  hba1c: 20,
  screening_compliance: 20,
  bmi: 15,
  smoking: 20,
} as const;

/** Normal range 18.5–24.9; score tapers off symmetrically outside it. */
function bmiSubScore(bmi: number): number {
  if (bmi >= 18.5 && bmi <= 24.9) return 100;
  const distance = bmi < 18.5 ? 18.5 - bmi : bmi - 24.9;
  return Math.max(0, 100 - distance * 8);
}

/** WHO HbA1c bands: <5.7% normal, 5.7–6.4% prediabetic, >=6.5% diabetic. */
function hba1cSubScore(hba1c: number): number {
  if (hba1c < 5.7) return 100;
  if (hba1c < 6.5) return 100 - ((hba1c - 5.7) / (6.5 - 5.7)) * 40;
  return Math.max(0, 60 - (hba1c - 6.5) * 15);
}

function smokingSubScore(
  status: "never" | "former" | "current",
  cigarettesPerDay: HealthScoreInputs["cigarettesPerDay"]
): number {
  if (status === "never") return 100;
  if (status === "former") return 70;
  // current
  switch (cigarettesPerDay) {
    case "1_5":
      return 40;
    case "6_10":
      return 25;
    case "11_20":
      return 10;
    case "20_plus":
      return 0;
    default:
      return 30;
  }
}

function riskLevelFor(score: number): HealthScoreRiskLevel {
  if (score >= 80) return "low";
  if (score >= 60) return "moderate";
  if (score >= 40) return "high";
  return "very_high";
}

export function computeHealthScore(inputs: HealthScoreInputs): ComputedHealthScore | null {
  const available: HealthScoreComponent[] = [];

  if (inputs.bpControlPercent !== null) {
    available.push({ key: "bp_control", value: inputs.bpControlPercent, weight: BASE_WEIGHTS.bp_control });
  }
  if (inputs.latestHba1cPercent !== null) {
    available.push({
      key: "hba1c",
      value: hba1cSubScore(inputs.latestHba1cPercent),
      weight: BASE_WEIGHTS.hba1c,
      detail: formatHba1cWithBracket(inputs.latestHba1cPercent),
    });
  }
  if (inputs.screeningCompliancePercent !== null) {
    available.push({
      key: "screening_compliance",
      value: inputs.screeningCompliancePercent,
      weight: BASE_WEIGHTS.screening_compliance,
    });
  }
  if (inputs.bmi !== null) {
    available.push({ key: "bmi", value: bmiSubScore(inputs.bmi), weight: BASE_WEIGHTS.bmi });
  }
  if (inputs.smokingStatus !== null) {
    available.push({
      key: "smoking",
      value: smokingSubScore(inputs.smokingStatus, inputs.cigarettesPerDay),
      weight: BASE_WEIGHTS.smoking,
    });
  }

  if (available.length === 0) return null;

  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = available.reduce((sum, c) => sum + c.value * c.weight, 0);
  const score = Math.round(weightedSum / totalWeight);

  return { score, riskLevel: riskLevelFor(score), components: available };
}

const TIP_THRESHOLD = 80;

const COMPONENT_TIP: Record<HealthScoreComponent["key"], string> = {
  bp_control:
    "Logging your blood pressure regularly and staying on top of your medication schedule can make a real difference here.",
  hba1c:
    "A chat with your care team about your next HbA1c check, plus small, steady changes to diet and movement, can help bring this down over time.",
  screening_compliance:
    "You've got a screening or two waiting — booking it through your care team is the single easiest way to lift this score.",
  bmi: "Small, sustainable shifts in activity or diet tend to move this in the right direction over time — no need to rush it.",
  smoking:
    "Cutting back on smoking, even gradually, is one of the fastest ways to lift both this score and your long-term health.",
};

/**
 * Non-alarming, clinician-voice suggestions for any component still below
 * TIP_THRESHOLD — per CLAUDE.md's brand voice ("a clinician who knows your
 * name, not a hospital PA system", no fear-based urgency). Only ever
 * suggests, never warns.
 */
export function getHealthScoreTips(components: HealthScoreComponent[]): string[] {
  return components.filter((c) => c.value < TIP_THRESHOLD).map((c) => COMPONENT_TIP[c.key]);
}
