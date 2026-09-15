import type { Enums } from "@tarragon/shared";

/**
 * Reproductive life-stage nudge engine — verbatim port of
 * apps/web/src/lib/rules/cycle-nudges.ts. Pure, no DB access. A nudge is a
 * suggestion for the patient to act on or discuss with their care team —
 * never a diagnosis, never fed into risk/escalation scoring. Cycle
 * PREDICTION (next period/ovulation) is not here — that's the larger cycle
 * tracker, now fully native (see cycle.ts and cycle-prediction.ts).
 */

export type ReproductiveLifeStage = Enums<"reproductive_life_stage">;

export interface CycleNudgeInput {
  lifeStage: ReproductiveLifeStage;
  lastPeriodDate: string | null;
  averageCycleLengthDays: number | null;
}

export interface CycleNudge {
  id: string;
  label: string;
}

export function computeCycleNudges(input: CycleNudgeInput): CycleNudge[] {
  const nudges: CycleNudge[] = [];

  switch (input.lifeStage) {
    case "menstruating":
      nudges.push({
        id: "open_cycle_tracker",
        label:
          "Track your period in the cycle tracker to see what to expect next, and log how you feel day to day.",
      });
      break;
    case "trying_to_conceive":
      nudges.push({
        id: "trying_to_conceive_checkin",
        label:
          "Trying to conceive: your care team can review your cycle history and any relevant screening before you start trying.",
      });
      break;
    case "pregnant":
      nudges.push({
        id: "antenatal_booking",
        label: "Book your antenatal care with your care team as early as possible in pregnancy.",
      });
      break;
    case "postpartum":
      nudges.push({
        id: "postpartum_checkin",
        label: "A postpartum check-in with your care team is recommended in the weeks after delivery.",
      });
      break;
    case "perimenopausal":
    case "menopausal":
      nudges.push({
        id: "menopause_checkin",
        label:
          "Perimenopause and menopause shift some health risks (bone, heart), worth a conversation with your care team.",
      });
      break;
    case "not_applicable":
      break;
  }

  return nudges;
}
