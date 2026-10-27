import { NO_WELLBEING_FEATURES, parseWellbeingFeatures } from "./features";

describe("wellbeing features fail closed", () => {
  it("opens a feature only on an exact true", () => {
    expect(parseWellbeingFeatures({ panic: true, insights: true, share: true, insights_hidden: true, worklist: true, worklist_activity_opt_out: true })).toEqual({ panic: true, insights: true, share: true, insightsHidden: true, worklist: true, worklistActivityOptOut: true });
    expect(parseWellbeingFeatures({ panic: true })).toEqual({ ...NO_WELLBEING_FEATURES, panic: true });
  });
  it("treats anything else as closed", () => {
    for (const bad of [null, undefined, "true", 1, [], [true], { panic: "true", insights: 1, share: "yes" }, {}]) {
      expect(parseWellbeingFeatures(bad)).toEqual(NO_WELLBEING_FEATURES);
    }
  });
});
