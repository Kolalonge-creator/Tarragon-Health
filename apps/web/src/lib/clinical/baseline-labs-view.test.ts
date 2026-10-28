import { baselineRulesView } from "./baseline-labs-view";

const good = {
  freshness_months: 12,
  tests_due_days: 7,
  egfr: { metformin_do_not_start_below: 30, metformin_review_dose_below: 45 },
  pregnancy: { classes: ["acei", "arb", "statin"], age_from: 12, age_to: 50 },
  classes: { acei: { label: "ACE inhibitor", requires: ["creatinine", "potassium"] }, ccb: { label: "Calcium channel blocker", requires: [] } },
  notes: { a: "Never blocks emergency care." },
};

describe("baselineRulesView", () => {
  it("shows every row and number straight from the draft", () => {
    const v = baselineRulesView(good);
    expect(v?.classes).toEqual([{ label: "ACE inhibitor", tests: "creatinine with eGFR, potassium" }, { label: "Calcium channel blocker", tests: "no blood test required" }]);
    expect(v?.thresholds.join(" ")).toMatch(/12 months/);
    expect(v?.thresholds.join(" ")).toMatch(/under 30 \(no override\)/);
    expect(v?.thresholds.join(" ")).toMatch(/under 45/);
    expect(v?.notes).toEqual(["Never blocks emergency care."]);
  });

  it("returns null, so the panel shows nothing to sign, when anything it must show is missing or malformed", () => {
    expect(baselineRulesView(null)).toBeNull();
    expect(baselineRulesView({ ...good, egfr: {} })).toBeNull();
    expect(baselineRulesView({ ...good, classes: { acei: { label: 5, requires: [] } } })).toBeNull();
    expect(baselineRulesView({ ...good, freshness_months: "12" })).toBeNull();
  });
});
