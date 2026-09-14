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
 * inspired by Hello Heart) were deliberately left out of this file's v1
 * scope — presenting a derived "age" is a stronger patient-facing clinical
 * claim than a 0–100 score and needs its own sign-off, not a drive-by
 * addition here. lib/rules/biological-age.ts now reframes this same score
 * as an age estimate, but that reframe is code only, not a sign-off — its
 * patient-facing surface (BiologicalAgeCard) is gated behind the
 * `biological_age_card` feature flag, default off, until a real Clinical
 * Director review happens. Do not treat the existence of that module as
 * the sign-off this comment is about.
 *
 * Blood-test components added 2026-09-14 (biomarker_heart/kidney/liver,
 * founder-requested expansion for Biological Age): same v2-addition pattern
 * as vaccination compliance below, and the same safety discipline as
 * everything else in this file — no new clinical thresholds invented. Each
 * reuses `lib/lab-reports/biomarker-categories.ts`'s existing rollup, which
 * itself only ever surfaces `lab_result_interpretations` rows a clinician
 * has actually reviewed (`source = 'clinician'`), never a raw value against
 * `analyte-catalogue.ts`'s reference ranges — that file's own header is
 * explicit those bands are "ORIENTATION ONLY... never used to classify a
 * result." `blood_sugar` (the biomarker-categories.ts group covering
 * fasting/random/OGTT glucose) is deliberately excluded here: HbA1c already
 * scores the same glycaemic signal via its own component below, and folding
 * both in would double-count one underlying clinical fact.
 */

export type HealthScoreRiskLevel = "low" | "moderate" | "high" | "very_high";

export interface HealthScoreInputs {
  /** % of blood_pressure readings in the trailing window under 140/90. Null if no readings. */
  bpControlPercent: number | null;
  /** Most recent HbA1c value (%). Null if never lab-tested. */
  latestHba1cPercent: number | null;
  /** % of already-due screenings completed rather than overdue. Null if none due yet. */
  screeningCompliancePercent: number | null;
  /** % of already-due vaccinations completed rather than overdue. Null if none due yet. */
  vaccinationCompliancePercent: number | null;
  /** Null if height or weight is missing. */
  bmi: number | null;
  smokingStatus: "never" | "former" | "current" | null;
  cigarettesPerDay: "1_5" | "6_10" | "11_20" | "20_plus" | null;
  /** From biomarker-categories.ts's rollup of clinician-reviewed lab results.
   * Null when no reviewed order has touched that category yet — never
   * inferred, matching every other input in this file. */
  heartBiomarkerStatus: "good" | "needs_attention" | null;
  kidneyBiomarkerStatus: "good" | "needs_attention" | null;
  liverBiomarkerStatus: "good" | "needs_attention" | null;
}

export type HealthScoreComponentKey =
  | "bp_control"
  | "hba1c"
  | "screening_compliance"
  | "vaccination"
  | "bmi"
  | "smoking"
  | "biomarker_heart"
  | "biomarker_kidney"
  | "biomarker_liver";

export interface HealthScoreComponent {
  key: HealthScoreComponentKey;
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

// Weights are relative, not a fixed 100 — the compute normalises by the
// total of whatever components are available. Vaccination compliance added
// as v2 (2026-07-23, prevention-first pass): same shape as screening
// compliance, only scored once something is actually due — never penalises
// a patient whose schedule hasn't been generated yet.
// biomarker_heart/kidney/liver weighted at 15 each (2026-09-14) — the same
// weight as bmi: a real, clinician-reviewed finding, but each covers only
// one body system, so no single panel should swing the overall score as
// hard as blood pressure or smoking can.
const BASE_WEIGHTS = {
  bp_control: 25,
  hba1c: 20,
  screening_compliance: 20,
  vaccination: 10,
  bmi: 15,
  smoking: 20,
  biomarker_heart: 15,
  biomarker_kidney: 15,
  biomarker_liver: 15,
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

/** A clinician has already reviewed and flagged this body system's panel as
 * outside normal — a confirmed finding, not a raw-value guess, so it scores
 * meaningfully below "good" without a further severity grade to work from
 * (biomarker-categories.ts's rollup is binary, by design — see its own
 * header on why it never grades severity itself). 40 sits in the same
 * register as a diabetic-range HbA1c (hba1cSubScore's floor above 6.5%),
 * not as low as heavy current smoking, which this file already treats as
 * the single worst input it scores. */
function biomarkerCategorySubScore(status: "good" | "needs_attention"): number {
  return status === "good" ? 100 : 40;
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
  if (inputs.vaccinationCompliancePercent !== null) {
    available.push({
      key: "vaccination",
      value: inputs.vaccinationCompliancePercent,
      weight: BASE_WEIGHTS.vaccination,
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
  if (inputs.heartBiomarkerStatus !== null) {
    available.push({
      key: "biomarker_heart",
      value: biomarkerCategorySubScore(inputs.heartBiomarkerStatus),
      weight: BASE_WEIGHTS.biomarker_heart,
      detail: "From your reviewed lab results",
    });
  }
  if (inputs.kidneyBiomarkerStatus !== null) {
    available.push({
      key: "biomarker_kidney",
      value: biomarkerCategorySubScore(inputs.kidneyBiomarkerStatus),
      weight: BASE_WEIGHTS.biomarker_kidney,
      detail: "From your reviewed lab results",
    });
  }
  if (inputs.liverBiomarkerStatus !== null) {
    available.push({
      key: "biomarker_liver",
      value: biomarkerCategorySubScore(inputs.liverBiomarkerStatus),
      weight: BASE_WEIGHTS.biomarker_liver,
      detail: "From your reviewed lab results",
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
  vaccination:
    "A vaccine on your schedule is still waiting — it's usually a single visit, and logging it lifts this straight to 100.",
  bmi: "Small, sustainable shifts in activity or diet tend to move this in the right direction over time — no need to rush it.",
  smoking:
    "Cutting back on smoking, even gradually, is one of the fastest ways to lift both this score and your long-term health.",
  biomarker_heart:
    "Your latest reviewed heart panel flagged something worth a closer look — a chat with your care team is the natural next step.",
  biomarker_kidney:
    "Your latest reviewed kidney panel flagged something worth a closer look — a chat with your care team is the natural next step.",
  biomarker_liver:
    "Your latest reviewed liver panel flagged something worth a closer look — a chat with your care team is the natural next step.",
};

/**
 * Non-alarming, doctor-voice suggestions for any component still below
 * TIP_THRESHOLD — per CLAUDE.md's brand voice ("a doctor who knows your
 * name, not a hospital PA system", no fear-based urgency). Only ever
 * suggests, never warns.
 */
export function getHealthScoreTips(components: HealthScoreComponent[]): string[] {
  return components.filter((c) => c.value < TIP_THRESHOLD).map((c) => COMPONENT_TIP[c.key]);
}

/**
 * The single component with the most room to improve, i.e. the lowest
 * sub-score below TIP_THRESHOLD — surfaced separately so the patient gets one
 * "start here" suggestion instead of a flat list to triage themselves.
 * Working the weakest component first gets the biggest lift to the overall
 * score, since every component is weighted the same 0-100 scale. Returns
 * null when nothing is below threshold, same as an empty getHealthScoreTips.
 */
export function getPriorityHealthScoreTip(
  components: HealthScoreComponent[],
): { key: HealthScoreComponent["key"]; tip: string } | null {
  const below = components.filter((c) => c.value < TIP_THRESHOLD);
  if (below.length === 0) return null;
  const lowest = below.reduce((min, c) => (c.value < min.value ? c : min));
  return { key: lowest.key, tip: COMPONENT_TIP[lowest.key] };
}

export interface HealthScoreTrendPoint {
  score: number;
  inputs: unknown;
  computed_at: string;
}

export interface HealthScoreTrend {
  firstScore: number;
  lastScore: number;
  firstDate: string;
  lastDate: string;
  scoreDelta: number;
  /** The bmi component's own 0-100 sub-score delta, only when both the
   * earliest and latest snapshot actually have a bmi component — never
   * inferred or estimated. */
  bmiSubScoreDelta: number | null;
}

function bmiSubScoreOf(inputs: unknown): number | null {
  const components = (inputs as { components?: HealthScoreComponent[] } | null)?.components;
  return components?.find((c) => c.key === "bmi")?.value ?? null;
}

/**
 * Turns raw ascending Health Score history into the "since you started"
 * trend a patient can actually read on their own progress — never fabricated
 * from a single point. Returns null with fewer than two real data points,
 * since there is nothing honest to say about a trend from one score.
 */
export function computeHealthScoreTrend(
  history: HealthScoreTrendPoint[],
): HealthScoreTrend | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const firstBmi = bmiSubScoreOf(first.inputs);
  const lastBmi = bmiSubScoreOf(last.inputs);
  return {
    firstScore: first.score,
    lastScore: last.score,
    firstDate: first.computed_at,
    lastDate: last.computed_at,
    scoreDelta: last.score - first.score,
    bmiSubScoreDelta: firstBmi !== null && lastBmi !== null ? lastBmi - firstBmi : null,
  };
}

/**
 * Plain-language line for the trend above — non-alarming either direction,
 * matching the brand voice's "doctor who knows your name" rule (no
 * fear-based urgency for a dip, no overclaiming for a rise).
 */
export function describeHealthScoreTrend(trend: HealthScoreTrend): string {
  const { scoreDelta, firstScore, lastScore, bmiSubScoreDelta } = trend;
  const direction =
    scoreDelta > 0
      ? `moved up from ${firstScore} to ${lastScore}`
      : scoreDelta < 0
        ? `moved from ${firstScore} to ${lastScore}`
        : `held steady at ${lastScore}`;
  let line = `Since your first check, your Health Score has ${direction}.`;
  if (bmiSubScoreDelta !== null && Math.abs(bmiSubScoreDelta) >= 1) {
    line +=
      bmiSubScoreDelta > 0
        ? " Your weight component moved in the right direction over the same period — that's real, measurable progress."
        : " Your weight component moved the other way over the same period — nothing to panic about, just something to revisit with your care team.";
  }
  return line;
}
