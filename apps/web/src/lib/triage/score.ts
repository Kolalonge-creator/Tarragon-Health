import type { EscalationLevel } from "@tarragon/shared";
import { effectiveAlertLevel } from "@/lib/worklist/priority";

/**
 * Deterministic, explainable triage scoring for the clinician cockpit.
 *
 * WHY A SCORE AND NOT JUST A SORT. compareAlerts (lib/worklist/priority.ts)
 * ranks by severity then SLA, which is correct but coarse: it cannot express
 * "this routine case has breached its SLA twice and the patient has bounced
 * back three times this month, so it outranks that fresh clinician_review".
 * The whole point of the cockpit is that a doctor's first case should be the
 * genuinely highest-value one, not merely the loudest-labelled one.
 *
 * THREE PROPERTIES THIS DELIBERATELY HOLDS, all of them load-bearing:
 *
 *  1. PURE AND DETERMINISTIC. No model, no network, no clock reads except the
 *     `now` you pass in. The same inputs always produce the same ranking and
 *     the same explanation, which is what makes it testable and auditable --
 *     a doctor who asks "why is this first?" gets an answer that is a fact,
 *     not a guess. Contrast case_briefs, which is explicitly an LLM surface.
 *
 *  2. SEVERITY IS NEVER OUTWEIGHED. Modifiers can reorder cases WITHIN a
 *     severity band but can never lift a routine case above an emergency --
 *     see SEVERITY_BASE's spacing and MAX_MODIFIER_POINTS, which is asserted
 *     in score.test.ts. A scoring system that lets enough small signals bury
 *     an emergency is a patient-safety bug, not a tuning problem.
 *
 *  3. EVERY POINT IS EXPLAINED. Each factor carries the sentence a human
 *     reads. There is no unattributed score: the total is exactly the sum of
 *     the factors shown, so the UI cannot display a number it cannot justify.
 *
 * This is not a risk score and must never be read as one. It ranks ATTENTION
 * (whose case should a doctor open next), not clinical acuity, and nothing
 * here is shown to a patient.
 */

/** Bumped when the weighting changes, so a stored ranking can be traced to its rules. */
export const TRIAGE_ENGINE_VERSION = 1;

/**
 * Spaced an order of magnitude apart, and far wider than MAX_MODIFIER_POINTS.
 * This spacing IS the safety property in (2) above -- it is not a tuning
 * choice and must not be narrowed without re-checking the assertion test.
 */
const SEVERITY_BASE: Record<EscalationLevel, number> = {
  emergency: 1300,
  specialist_review: 1000,
  urgent_escalation: 700,
  clinician_review: 400,
  routine: 100,
};

/**
 * The most any combination of modifiers can contribute. Kept below the
 * smallest gap between two severity bands (400 - 100 = 300), so the bands can
 * never cross. Asserted, not assumed -- see score.test.ts.
 */
export const MAX_MODIFIER_POINTS = 260;

export interface TriageFactor {
  /** Stable identifier, for tests and for grouping in the UI. */
  key: string;
  /** The sentence a doctor reads. Written for a human, not a log. */
  label: string;
  points: number;
}

export interface TriageResult {
  score: number;
  factors: TriageFactor[];
  /** The single most important reason this case ranks where it does. */
  headline: string;
  engineVersion: number;
}

/**
 * Everything the score is allowed to look at. Kept to fields the worklist
 * already fetches, plus counts -- so ranking never costs an extra round trip
 * per case, which would defeat the point of a fast cockpit.
 */
export interface TriageInput {
  level: EscalationLevel;
  overrideLevel?: EscalationLevel | null;
  slaDueAt: string | null;
  createdAt: string;
  /** Screening result status, when this alert came from one. */
  screeningResultStatus?: string | null;
  /** Resolved escalations for this patient in the recent window. */
  priorEscalationCount?: number;
  /** Active care plans -- a proxy for multimorbidity, not a severity claim. */
  activeConditionCount?: number;
  /** True when the latest risk score for this patient is high/very high. */
  hasHighRiskScore?: boolean;
  /** True when the patient has logged no reading since the alert fired. */
  awaitingPatientData?: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

function hoursBetween(fromIso: string, to: Date): number {
  return (to.getTime() - new Date(fromIso).getTime()) / HOUR_MS;
}

/**
 * Scores one case. `now` is injected rather than read, so a test can pin time
 * and so a whole worklist ranks against ONE instant -- ranking rows against
 * slightly different `Date.now()` values is how you get a list that reorders
 * itself while a doctor is looking at it.
 */
export function scoreCase(input: TriageInput, now: Date): TriageResult {
  const level = effectiveAlertLevel({ level: input.level, override_level: input.overrideLevel });
  const factors: TriageFactor[] = [];

  // --- SLA: the strongest modifier, because a breached SLA is a promise
  // already broken, not a prediction. Graded rather than binary so a case
  // 20 minutes from breaching outranks one with six hours left.
  if (input.slaDueAt) {
    const hoursRemaining = -hoursBetween(input.slaDueAt, now);
    if (hoursRemaining < 0) {
      const hoursOverdue = Math.abs(hoursRemaining);
      // Capped: a case 30 days overdue is not 30x more urgent than one a day
      // overdue, and letting it run away would starve everything else.
      const points = Math.min(120, 60 + Math.round(hoursOverdue * 5));
      factors.push({
        key: "sla_breached",
        label:
          hoursOverdue < 1
            ? "SLA breached within the last hour"
            : `SLA breached ${formatDuration(hoursOverdue)} ago`,
        points,
      });
    } else if (hoursRemaining <= 1) {
      factors.push({ key: "sla_imminent", label: "SLA due within the hour", points: 50 });
    } else if (hoursRemaining <= 4) {
      factors.push({ key: "sla_soon", label: "SLA due within four hours", points: 30 });
    }
  }

  // --- Abnormal screening result. CLAUDE.md's highest-priority business
  // event: a Category 2 -> 1 upgrade must never be lost or quietly deprioritised.
  // Weighted heavily inside the band for exactly that reason.
  if (input.screeningResultStatus === "abnormal" || input.screeningResultStatus === "critical") {
    factors.push({
      key: "abnormal_screening",
      label:
        input.screeningResultStatus === "critical"
          ? "Critical screening result awaiting review"
          : "Abnormal screening result awaiting review",
      points: input.screeningResultStatus === "critical" ? 60 : 45,
    });
  }

  // --- Repeat escalations. A patient bouncing back is a signal the last
  // resolution did not hold -- the case most worth a doctor's full attention
  // rather than a quick close.
  const priors = input.priorEscalationCount ?? 0;
  if (priors >= 3) {
    factors.push({
      key: "repeat_escalations_high",
      label: `${priors} previous escalations on record — earlier resolutions have not held`,
      points: 35,
    });
  } else if (priors === 2) {
    factors.push({
      key: "repeat_escalations",
      label: "2 previous escalations on record",
      points: 20,
    });
  }

  // --- Multimorbidity. A proxy for how much work the case is, and for how
  // easily a single-condition protocol misses something -- never a claim
  // about how sick the patient is.
  const conditions = input.activeConditionCount ?? 0;
  if (conditions >= 3) {
    factors.push({
      key: "multimorbidity",
      label: `${conditions} active conditions — interacting care plans`,
      points: 20,
    });
  } else if (conditions === 2) {
    factors.push({ key: "two_conditions", label: "2 active conditions", points: 10 });
  }

  if (input.hasHighRiskScore) {
    factors.push({
      key: "high_risk_score",
      label: "Latest risk score is high",
      points: 25,
    });
  }

  // --- Negative modifier. A case that cannot progress until the patient
  // logs a reading should not sit at the top of a doctor's queue burning
  // attention -- it belongs with the care coordinator chasing it. Small, and
  // never applied to emergencies, where waiting is not an option.
  if (input.awaitingPatientData && level !== "emergency") {
    factors.push({
      key: "awaiting_patient",
      label: "Blocked on the patient logging a reading",
      points: -25,
    });
  }

  // --- Age. A quiet last-resort tiebreaker so nothing can sit forever behind
  // a stream of fresher, slightly-higher-scoring cases. Deliberately tiny.
  const ageHours = hoursBetween(input.createdAt, now);
  if (ageHours >= 48) {
    factors.push({
      key: "ageing",
      label: `Open for ${formatDuration(ageHours)}`,
      points: Math.min(15, Math.round(ageHours / 24) * 5),
    });
  }

  const rawModifier = factors.reduce((sum, factor) => sum + factor.points, 0);
  // Clamped, not trusted to stay in range: this is what makes property (2)
  // hold no matter what combination of factors fires.
  const modifier = Math.max(-MAX_MODIFIER_POINTS, Math.min(MAX_MODIFIER_POINTS, rawModifier));

  const severityFactor: TriageFactor = {
    key: `severity_${level}`,
    label: SEVERITY_LABEL[level],
    points: SEVERITY_BASE[level],
  };

  // Severity first, then modifiers by impact -- the explanation reads in the
  // order a doctor would reason about it.
  const ordered = [severityFactor, ...factors.slice().sort((a, b) => b.points - a.points)];

  return {
    score: SEVERITY_BASE[level] + modifier,
    factors: ordered,
    headline: headlineFor(severityFactor, factors),
    engineVersion: TRIAGE_ENGINE_VERSION,
  };
}

const SEVERITY_LABEL: Record<EscalationLevel, string> = {
  emergency: "Emergency",
  specialist_review: "Specialist review",
  urgent_escalation: "Urgent escalation",
  clinician_review: "Needs clinician review",
  routine: "Routine",
};

/**
 * The one line shown next to a case in the ranked list. Prefers the biggest
 * positive modifier over the severity band, because severity is already
 * visible as a badge -- repeating it would waste the only line we get.
 */
function headlineFor(severity: TriageFactor, modifiers: TriageFactor[]): string {
  const strongest = modifiers
    .filter((factor) => factor.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  return strongest ? strongest.label : severity.label;
}

function formatDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} min`;
  }
  if (hours < 48) {
    const whole = Math.round(hours);
    return `${whole} hour${whole === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Ranks a worklist against a single instant. Stable: cases tied on score keep
 * their incoming order, so an already-severity-sorted list stays sensible.
 */
export function rankCases<T>(
  rows: T[],
  toInput: (row: T) => TriageInput,
  now: Date = new Date()
): { row: T; triage: TriageResult }[] {
  return rows
    .map((row) => ({ row, triage: scoreCase(toInput(row), now) }))
    .sort((a, b) => b.triage.score - a.triage.score);
}
