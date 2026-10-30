import type { CyclePrediction, ReproductiveLifeStage } from "./prediction";

export interface CycleHero {
  /** Null before any period is logged: the page shows the prompt, never a made-up number. */
  value: string | number | null;
  unit?: string;
  caption: string;
}

/**
 * The one big line on the cycle page, from the same prediction the ring uses so the two cannot disagree.
 * Wording follows nextPeriodSummary's branches, including the inside-the-window case where the day count
 * has gone negative but the period is not yet "late".
 */
export function cycleHero(prediction: CyclePrediction): CycleHero {
  if (!prediction.predictedNextPeriodDate) {
    return { value: null, caption: "Log your first period and we will estimate the next one." };
  }
  const estimate = "An estimate from your own logged cycles, not a promise.";
  if (prediction.isOverdue) {
    const days = prediction.daysOverdue ?? 0;
    return { value: days, unit: days === 1 ? "day late" : "days late", caption: `Past your estimated date. ${estimate}` };
  }
  const until = prediction.daysUntilNextPeriod;
  if (until === null || until < 0) return { value: "Any day", caption: estimate };
  if (until === 0) return { value: "Today", caption: estimate };
  return { value: until, unit: until === 1 ? "day to your period" : "days to your period", caption: estimate };
}

/**
 * Whether the countdown belongs on the page at all: only while periods are expected (not pregnant, postpartum or menopausal life
 * stages), and never beside an urgent flag, where the flag is the one thing the page should lead with.
 */
export function showCycleHero(lifeStage: ReproductiveLifeStage, prediction: CyclePrediction): boolean {
  return (lifeStage === "menstruating" || lifeStage === "trying_to_conceive") && !prediction.flags.some((flag) => flag.severity === "urgent");
}
