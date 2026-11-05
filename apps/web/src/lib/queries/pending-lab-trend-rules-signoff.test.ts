import { describe, expect, it, jest } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";

jest.mock("server-only", () => ({}));
import { labTrendRulesView } from "./pending-lab-trend-rules-signoff";

describe("labTrendRulesView (T2 Phase 2 hub panel)", () => {
  const config = getProposedConfig("lab.trend_rules").value;

  it("reads the proposed rule set the CMO will sign", () => {
    const v = labTrendRulesView(config);
    expect(v?.windowMonths).toBe(12);
    expect(v?.rules.map((r) => r.analyte)).toEqual(["hba1c", "fasting_glucose", "creatinine", "ldl_cholesterol", "haemoglobin", "potassium"]);
    expect(v?.rules.find((r) => r.analyte === "haemoglobin")?.change).toEqual({ kind: "fall", amount: 2 });
    expect(v?.rules.find((r) => r.analyte === "creatinine")?.change).toEqual({ kind: "rise_pct", amount: 25 });
    expect(v?.persistent?.minPoints).toBe(3);
    expect(v?.review.slaPathway).toBe("screening_abnormal_result");
  });

  it("refuses a rule with two change kinds or no review block, so the panel never offers Sign on a broken version", () => {
    const c = JSON.parse(JSON.stringify(config)) as { rules: Record<string, unknown>[]; review?: unknown };
    c.rules[0]!.fall_from_first = 1;
    expect(labTrendRulesView(c)).toBeNull();
    const d = JSON.parse(JSON.stringify(config)) as { review?: unknown };
    delete d.review;
    expect(labTrendRulesView(d)).toBeNull();
    expect(labTrendRulesView(null)).toBeNull();
  });
});
