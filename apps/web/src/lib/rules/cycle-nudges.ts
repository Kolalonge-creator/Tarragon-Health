import type { Enums } from "@tarragon/shared";

/**
 * Reproductive life-stage + cycle nudge engine — the women's-health-bridge
 * counterpart to computeVaccinationStatuses/computeScreeningRecommendations:
 * pure, no DB access, so it's unit-testable and safe to re-run on every
 * render. A nudge is a suggestion for the patient to act on or discuss with
 * their care team — never a diagnosis, never fed into risk/escalation
 * scoring (same discipline as mental_health_screens' "engagement telemetry,
 * not clinical" rule). The next-period estimate is explicitly labelled an
 * estimate, not a prediction.
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

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeCycleNudges(input: CycleNudgeInput): CycleNudge[] {
  const nudges: CycleNudge[] = [];

  switch (input.lifeStage) {
    case "menstruating": {
      if (input.lastPeriodDate) {
        const cycleLength = input.averageCycleLengthDays ?? 28;
        const estimate = addDays(input.lastPeriodDate, cycleLength);
        nudges.push({
          id: "next_period_estimate",
          label: `Estimated next period around ${new Date(estimate).toLocaleDateString()} (based on your average cycle — not a prediction).`,
        });
      }
      break;
    }
    case "trying_to_conceive": {
      nudges.push({
        id: "trying_to_conceive_checkin",
        label:
          "Trying to conceive: your care team can review your cycle history and any relevant screening before you start trying.",
      });
      break;
    }
    case "pregnant": {
      nudges.push({
        id: "antenatal_booking",
        label: "Book your antenatal care with your care team as early as possible in pregnancy.",
      });
      break;
    }
    case "postpartum": {
      nudges.push({
        id: "postpartum_checkin",
        label: "A postpartum check-in with your care team is recommended in the weeks after delivery.",
      });
      break;
    }
    case "perimenopausal":
    case "menopausal": {
      nudges.push({
        id: "menopause_checkin",
        label:
          "Perimenopause and menopause shift some health risks (bone, heart) — worth a conversation with your care team.",
      });
      break;
    }
    case "not_applicable":
      break;
  }

  return nudges;
}
