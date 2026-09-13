import { isFirstRun, shouldShowGetStarted } from "./get-started-card";

const NONE = { hasRiskAssessment: false, hasAnyVitals: false, hasMedications: false };
const ALL = { hasRiskAssessment: true, hasAnyVitals: true, hasMedications: true };

describe("shouldShowGetStarted", () => {
  it("shows on a brand-new account", () => {
    expect(shouldShowGetStarted(NONE)).toBe(true);
  });

  it("keeps showing while any single step is outstanding", () => {
    // Somebody who logged a reading but never filled in a health profile has
    // no screening calendar, and the old dashboard offered them no route to
    // one. Partial progress must not dismiss the card.
    expect(shouldShowGetStarted({ ...ALL, hasRiskAssessment: false })).toBe(true);
    expect(shouldShowGetStarted({ ...ALL, hasAnyVitals: false })).toBe(true);
    expect(shouldShowGetStarted({ ...ALL, hasMedications: false })).toBe(true);
  });

  it("removes itself once all three are done", () => {
    expect(shouldShowGetStarted(ALL)).toBe(false);
  });
});

describe("isFirstRun", () => {
  it("is true only on a genuinely empty account", () => {
    expect(isFirstRun(NONE)).toBe(true);
  });

  it("is false as soon as there is anything real to render", () => {
    // This gate suppresses the whole analytic stack, so a single piece of
    // real data has to be enough to bring the normal dashboard back. Getting
    // this wrong hides a real patient's own charts from them.
    expect(isFirstRun({ ...NONE, hasAnyVitals: true })).toBe(false);
    expect(isFirstRun({ ...NONE, hasMedications: true })).toBe(false);
    expect(isFirstRun({ ...NONE, hasRiskAssessment: true })).toBe(false);
  });

  it("never suppresses a dashboard it would also mark fully set up", () => {
    expect(isFirstRun(ALL)).toBe(false);
  });
});
