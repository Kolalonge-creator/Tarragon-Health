/**
 * S61 device parity. The phone's bundled offline classifier reads the SAME versioned PROPOSED config entry as the web classifier and the
 * diabetes pathway rule set, and a danger event at a low reading is an emergency on the phone exactly as on the server. The pathway
 * engine is the one the server runs, imported here, so a drift in either direction fails this test.
 */
import { getProposedConfig } from "@tarragon/shared";
import { DIABETES_CARE_V1, buildGlucoseFacts, gradePathway } from "@tarragon/clinical/pathways";
import { GLUCOSE_THRESHOLDS, GLUCOSE_THRESHOLDS_CONFIG_VERSION, classifyGlucoseOffline } from "./glucose-red-flags";

describe("device: glucose thresholds are the config entry", () => {
  it("equals the registry entry and carries its version", () => {
    const entry = getProposedConfig<Record<string, number>>("diabetes.glucose_thresholds");
    for (const [k, v] of Object.entries(GLUCOSE_THRESHOLDS)) expect([k, v]).toEqual([k, entry.value[k]]);
    expect(GLUCOSE_THRESHOLDS_CONFIG_VERSION).toBe(`cfg-v${entry.version}`);
  });
});

describe("device: glucose 2.8 mmol/L with confusion is an emergency offline", () => {
  it("fires with no network and no history", () => {
    const flag = classifyGlucoseOffline(2.8, null, GLUCOSE_THRESHOLDS, ["confusion"]);
    expect(flag.tier).toBe("emergency");
  });

  it("device and server agree on red versus not red over a grid", () => {
    const now = "2026-10-07T10:00:00Z";
    for (const mmol of [2.0, 2.8, 2.99, 3.0, 3.5, 3.89, 3.9, 5, 10.9, 11, 19.9, 20, 30]) {
      for (const ketone of [null, 3.5]) {
        for (const events of [[], ["confusion"], ["seizure"], ["unresponsive"], ["needed_help"]] as const) {
          const device = classifyGlucoseOffline(mmol, ketone, GLUCOSE_THRESHOLDS, events);
          const facts = buildGlucoseFacts({ latest: { mmol, takenAt: now, events }, history: [], ketoneMmol: ketone, ketoneUrine: null, insulinOrSulfonylurea: null, now });
          const server = gradePathway({ facts, readingAt: now, now }, DIABETES_CARE_V1);
          expect([mmol, ketone, events.join(), device.tier === "emergency"]).toEqual([mmol, ketone, events.join(), server.grade === "red"]);
        }
      }
    }
  });

  it("an event at 3.9 or higher is not an emergency", () => {
    expect(classifyGlucoseOffline(3.9, null, GLUCOSE_THRESHOLDS, ["confusion"]).tier).toBe("none");
  });
});
