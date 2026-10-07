import { describe, expect, it } from "@jest/globals";
import { mapEcgClassification, readLatestWatchEcg } from "./healthkit-ecg";

describe("Apple Watch ECG classification mapping (the device's own result, no algorithm of ours)", () => {
  it("maps each Apple classification to the server vocabulary", () => {
    expect(mapEcgClassification("sinusRhythm").classification).toBe("sinus_rhythm");
    expect(mapEcgClassification("atrialFibrillation").classification).toBe("irregular_rhythm");
    for (const c of ["inconclusiveLowHeartRate", "inconclusiveHighHeartRate", "inconclusivePoorReading", "inconclusiveOther"]) {
      expect(mapEcgClassification(c).classification).toBe("inconclusive");
    }
    expect(mapEcgClassification("notSet").classification).toBe("not_classified");
    expect(mapEcgClassification("somethingNewInAFutureIos").classification).toBe("not_classified");
  });
  it("only an irregular or inconclusive result can lead to a task: a normal or unknown one never does", () => {
    const leadsToReview = (c: string) => ["irregular_rhythm", "inconclusive"].includes(mapEcgClassification(c).classification);
    expect(leadsToReview("sinusRhythm")).toBe(false);
    expect(leadsToReview("notSet")).toBe(false);
    expect(leadsToReview("atrialFibrillation")).toBe(true);
    expect(leadsToReview("inconclusiveOther")).toBe(true);
  });
  it("keeps the device's wording short enough for the database column", () => {
    for (const c of ["sinusRhythm", "atrialFibrillation", "inconclusiveLowHeartRate", "inconclusiveHighHeartRate", "inconclusivePoorReading", "inconclusiveOther", "notSet"]) {
      expect(mapEcgClassification(c).deviceResultText.length).toBeLessThanOrEqual(120);
    }
  });
  it("reports unavailable, without touching a native module, off iOS or in a build without HealthKit", async () => {
    expect(await readLatestWatchEcg()).toEqual({ status: "unavailable" });
  });
});
