import { getProposedConfig } from "@tarragon/shared";
import {
  DIABETES_CARE_V1,
  buildGlucoseFacts,
  gradePathway,
} from "@tarragon/clinical/pathways";
import {
  GLUCOSE_THRESHOLDS,
  GLUCOSE_THRESHOLDS_VERSION,
  PERSISTENT_HIGH_MIN_COUNT,
  RECURRENT_HYPO_MIN_COUNT,
  classifyGlucose,
  type GlucoseAssessmentInput,
} from "./glucose-red-flags";

const input = (p: Partial<GlucoseAssessmentInput>): GlucoseAssessmentInput => ({
  latestGlucose: null,
  latestKetoneMmol: null,
  latestKetoneUrine: null,
  recentGlucose: [],
  ...p,
});

describe("S61: thresholds come from the versioned PROPOSED config", () => {
  const entry = getProposedConfig<Record<string, number>>("diabetes.glucose_thresholds");

  it("every threshold equals the registry entry and the served version is the config version", () => {
    for (const [k, v] of Object.entries(GLUCOSE_THRESHOLDS)) expect([k, v]).toEqual([k, entry.value[k]]);
    expect(PERSISTENT_HIGH_MIN_COUNT).toBe(entry.value.persistentHighMinCount);
    expect(RECURRENT_HYPO_MIN_COUNT).toBe(entry.value.recurrentHypoMinCount);
    expect(GLUCOSE_THRESHOLDS_VERSION).toBe(`cfg-v${entry.version}`);
  });

  it("the numbers did not change in the move: they are the old hard-coded values", () => {
    expect(GLUCOSE_THRESHOLDS).toEqual({ severeHypo: 3.0, hypoAlert: 3.9, highForDka: 11.0, veryHigh: 20.0, persistentHigh: 14.0, ketoneHigh: 3.0, ketoneModerate: 1.5 });
  });
});

describe("S61: danger events make a low reading an emergency (decision Q5)", () => {
  it("glucose 2.8 mmol/L with confusion is an emergency", () => {
    const flag = classifyGlucose(input({ latestGlucose: 2.8, recentGlucose: [2.8], glucoseEvents: ["confusion"] }));
    expect(flag.tier).toBe("emergency");
    expect(flag.kind).toBe("severe_hypo");
  });

  it.each(["confusion", "seizure", "unresponsive", "needed_help"] as const)("%s at 3.5 mmol/L is an emergency, the same reading without it is not", (e) => {
    expect(classifyGlucose(input({ latestGlucose: 3.5, recentGlucose: [3.5], glucoseEvents: [e] })).tier).toBe("emergency");
    expect(classifyGlucose(input({ latestGlucose: 3.5, recentGlucose: [3.5] })).tier).toBe("urgent");
  });

  it("an event at 3.9 or higher does not turn a normal reading into an emergency", () => {
    expect(classifyGlucose(input({ latestGlucose: 3.9, recentGlucose: [3.9], glucoseEvents: ["confusion"] })).tier).toBe("none");
  });

  it("server parity: the legacy classifier and the pathway rule set agree on red versus not red over a grid", () => {
    const now = "2026-10-07T10:00:00Z";
    for (const mmol of [2.0, 2.8, 2.99, 3.0, 3.5, 3.89, 3.9, 5, 10.9, 11, 19.9, 20, 30]) {
      for (const ketone of [null, 3.5]) {
        for (const events of [[], ["confusion"], ["seizure"], ["unresponsive"], ["needed_help"]] as const) {
          const legacy = classifyGlucose(input({ latestGlucose: mmol, latestKetoneMmol: ketone, recentGlucose: [mmol], glucoseEvents: events }));
          const facts = buildGlucoseFacts({ latest: { mmol, takenAt: now, events }, history: [], ketoneMmol: ketone, ketoneUrine: null, insulinOrSulfonylurea: null, now });
          const pathway = gradePathway({ facts, readingAt: now, now }, DIABETES_CARE_V1);
          expect([mmol, ketone, events.join(), legacy.tier === "emergency"]).toEqual([mmol, ketone, events.join(), pathway.grade === "red"]);
        }
      }
    }
  });
});
