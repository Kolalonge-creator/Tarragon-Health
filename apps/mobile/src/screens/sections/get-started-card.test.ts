import { isFirstRun, shouldShowGetStarted } from "./get-started-card";

const NONE = { hasRiskAssessment: false, hasAnyVitals: false, hasMedications: false };
const ALL = { hasRiskAssessment: true, hasAnyVitals: true, hasMedications: true };

describe("native get-started gating", () => {
  it("matches web: shows on an empty account, hides once all three are done", () => {
    expect(shouldShowGetStarted(NONE)).toBe(true);
    expect(shouldShowGetStarted(ALL)).toBe(false);
  });

  it("keeps showing while any single step is outstanding", () => {
    expect(shouldShowGetStarted({ ...ALL, hasRiskAssessment: false })).toBe(true);
    expect(shouldShowGetStarted({ ...ALL, hasAnyVitals: false })).toBe(true);
    expect(shouldShowGetStarted({ ...ALL, hasMedications: false })).toBe(true);
  });

  it("only suppresses the stat tiles on a genuinely empty account", () => {
    expect(isFirstRun(NONE)).toBe(true);
    expect(isFirstRun({ ...NONE, hasAnyVitals: true })).toBe(false);
    expect(isFirstRun({ ...NONE, hasMedications: true })).toBe(false);
    expect(isFirstRun({ ...NONE, hasRiskAssessment: true })).toBe(false);
  });
});
