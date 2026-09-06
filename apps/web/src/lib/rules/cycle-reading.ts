import type { CyclePhase, ReproductiveLifeStage } from "./cycle-prediction";

/**
 * Maps where a patient is in her cycle (and life stage) to reading that
 * already exists in the platform's health-education library.
 *
 * Deliberately a MAPPING and not a content file. Every article referenced
 * here is an existing clinician-reviewed row in health_education_content,
 * so the cycle page can offer relevant reading without anyone writing new
 * medical copy inside a UI component, and without a second, unreviewed
 * library growing beside the reviewed one.
 *
 * Codes are checked against the live catalogue by a test, so a renamed or
 * retired article fails a test rather than rendering a dead link.
 */

export interface CycleReading {
  /** health_education_content.code */
  code: string;
  title: string;
  /** Why it is being offered right now, in the patient's terms. */
  reason: string;
}

/** Content that applies regardless of phase, keyed by an observed situation. */
export const IRREGULAR_CYCLES_READING: CycleReading = {
  code: "women-irregular-periods",
  title: "Irregular periods: when to get it checked",
  reason: "Your cycle lengths have been varying a fair bit.",
};

const PHASE_READING: Record<CyclePhase, CycleReading | null> = {
  menstrual: {
    code: "women-menstrual-cycle",
    title: "Understanding your menstrual cycle",
    reason: "You are on your period.",
  },
  follicular: {
    code: "women-menstrual-cycle",
    title: "Understanding your menstrual cycle",
    reason: "A good time to get familiar with what your cycle is doing.",
  },
  fertile: {
    code: "women-fertility-basics",
    title: "Fertility basics: what affects it",
    reason: "You are in your estimated fertile window.",
  },
  ovulation: {
    code: "women-fertility-basics",
    title: "Fertility basics: what affects it",
    reason: "Ovulation is estimated around now.",
  },
  luteal: {
    code: "women-menstrual-cycle",
    title: "Understanding your menstrual cycle",
    reason: "The stretch before your next period.",
  },
  unknown: null,
};

const LIFE_STAGE_READING: Partial<Record<ReproductiveLifeStage, CycleReading>> = {
  trying_to_conceive: {
    code: "women-preconception-health",
    title: "Preparing your body before pregnancy",
    reason: "You told us you are trying to conceive.",
  },
  pregnant: {
    code: "women-pregnancy-warning-signs",
    title: "Pregnancy warning signs that need urgent care",
    reason: "Worth reading early in pregnancy, not when something is already wrong.",
  },
  postpartum: {
    code: "women-postpartum-recovery",
    title: "Postpartum recovery: physical and emotional",
    reason: "You told us you are in the first year after delivery.",
  },
  perimenopausal: {
    code: "women-menopause-what-to-expect",
    title: "Menopause: what to expect",
    reason: "You told us you are approaching menopause.",
  },
  menopausal: {
    code: "women-bone-health-menopause",
    title: "Bone health after menopause",
    reason: "Bone and heart risk shift after menopause.",
  },
};

/**
 * Life stage wins over phase: somebody who has told us she is pregnant does
 * not need "you are in your luteal phase" reading, and a cycle phase
 * computed from a stale last period would be wrong for her anyway.
 *
 * At most two suggestions, because a wall of links is the same as none.
 */
export function suggestCycleReading(input: {
  phase: CyclePhase;
  lifeStage: ReproductiveLifeStage;
  isIrregular: boolean;
}): CycleReading[] {
  const stage = LIFE_STAGE_READING[input.lifeStage];
  if (stage) {
    return input.isIrregular && input.lifeStage === "trying_to_conceive"
      ? [stage, IRREGULAR_CYCLES_READING]
      : [stage];
  }

  const suggestions: CycleReading[] = [];
  if (input.isIrregular) suggestions.push(IRREGULAR_CYCLES_READING);
  const phase = PHASE_READING[input.phase];
  if (phase && !suggestions.some((s) => s.code === phase.code)) suggestions.push(phase);
  return suggestions.slice(0, 2);
}

/** Every code this module can emit, for the catalogue-drift test. */
export const ALL_CYCLE_READING_CODES = [
  ...new Set([
    IRREGULAR_CYCLES_READING.code,
    ...Object.values(PHASE_READING).filter(Boolean).map((r) => (r as CycleReading).code),
    ...Object.values(LIFE_STAGE_READING).map((r) => r.code),
  ]),
].sort();
