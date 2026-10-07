import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { classifyLabResult, explanationAllowed, LabEntryError, type LabItemInput, type LabPanelDefinition } from "./lab-release";

const panels = getProposedConfig("lab.panels").value as { panels: Record<string, LabPanelDefinition> };
const essential = panels.panels.essential!;
const annual = panels.panels.annual_health_check!;

const NORMAL: LabItemInput[] = [
  { analyteCode: "fasting_glucose", valueNumeric: 88 }, { analyteCode: "hba1c", valueNumeric: 5.2 },
  { analyteCode: "creatinine", valueNumeric: 0.9 }, { analyteCode: "potassium", valueNumeric: 4.1 },
  { analyteCode: "sodium", valueNumeric: 140 }, { analyteCode: "total_cholesterol", valueNumeric: 170 },
  { analyteCode: "ldl_cholesterol", valueNumeric: 100 }, { analyteCode: "hdl_cholesterol", valueNumeric: 55 },
  { analyteCode: "triglycerides", valueNumeric: 110 }, { analyteCode: "alt", valueNumeric: 24 },
];
const with_ = (code: string, v: Partial<LabItemInput>): LabItemInput[] => NORMAL.map((i) => (i.analyteCode === code ? { ...i, ...v } : i));

describe("safety case 13: an all-normal result auto-releases with RES-001", () => {
  it("releases and creates no task", () => {
    const r = classifyLabResult(essential, NORMAL);
    expect(r.releaseState).toBe("released");
    expect(r.reason).toBe("RES-001");
    expect(r.task).toBeNull();
  });
  it("a value exactly on a range edge is normal", () => {
    expect(classifyLabResult(essential, with_("creatinine", { valueNumeric: 1.3 })).releaseState).toBe("released");
    expect(classifyLabResult(essential, with_("hdl_cholesterol", { valueNumeric: 40 })).releaseState).toBe("released");
  });
});

describe("safety case 11: raised creatinine is held for review", () => {
  it("1.8 mg/dL is high, held, routine review", () => {
    const r = classifyLabResult(essential, with_("creatinine", { valueNumeric: 1.8 }));
    expect(r.releaseState).toBe("awaiting_review");
    expect(r.items.find((i) => i.analyteCode === "creatinine")?.flag).toBe("high");
    expect(r.task).toBe("routine_result_review");
  });
  it("a critical value is held with the higher priority task", () => {
    const r = classifyLabResult(essential, with_("potassium", { valueNumeric: 7.1 }));
    expect(r.releaseState).toBe("awaiting_review");
    expect(r.reason).toBe("critical");
    expect(r.task).toBe("critical_result_review");
  });
  it("a low value is held too", () => {
    expect(classifyLabResult(essential, with_("hdl_cholesterol", { valueNumeric: 30 })).releaseState).toBe("awaiting_review");
  });
});

describe("safety case 12: a positive HBsAg needs a clinician to disclose it", () => {
  const sensitive = (code: string, text: string): LabItemInput[] => [...NORMAL, { analyteCode: code, valueText: text }];
  it.each(["hbsag", "hcv_ab", "hiv_screen"])("%s positive forces disclosure, no explanation, a disclosure task", (code) => {
    const r = classifyLabResult(annual, [...sensitive(code, "positive"), { analyteCode: "ast", valueNumeric: 20 }, { analyteCode: "haemoglobin", valueNumeric: 14 }, { analyteCode: "wbc", valueNumeric: 6 }, { analyteCode: "platelets", valueNumeric: 250 }, { analyteCode: "tsh", valueNumeric: 2 }]);
    expect(r.releaseState).toBe("clinician_disclosure_required");
    expect(r.task).toBe("sensitive_result_disclosure");
    expect(explanationAllowed(r.items, r.releaseState)).toBe(false);
  });
  it("sensitive positive wins over a critical value", () => {
    const r = classifyLabResult(annual, [...with_("potassium", { valueNumeric: 7.5 }), { analyteCode: "hbsag", valueText: "Positive" }]);
    expect(r.releaseState).toBe("clinician_disclosure_required");
  });
  it("a negative sensitive screen with otherwise complete normal values auto-releases", () => {
    const full: LabItemInput[] = [...NORMAL, { analyteCode: "ast", valueNumeric: 20 }, { analyteCode: "haemoglobin", valueNumeric: 14 }, { analyteCode: "wbc", valueNumeric: 6 }, { analyteCode: "platelets", valueNumeric: 250 }, { analyteCode: "tsh", valueNumeric: 2 }, { analyteCode: "hbsag", valueText: "negative" }];
    const r = classifyLabResult(annual, full);
    expect(r.releaseState).toBe("released");
    expect(explanationAllowed(r.items, r.releaseState)).toBe(true);
  });
});

describe("incomplete and malformed entries never auto-release", () => {
  it("a missing required analyte is held", () => {
    const r = classifyLabResult(essential, NORMAL.filter((i) => i.analyteCode !== "alt"));
    expect(r.releaseState).toBe("awaiting_review");
    expect(r.reason).toBe("incomplete");
    expect(r.missingRequired).toEqual(["alt"]);
  });
  it("an empty submission is held", () => expect(classifyLabResult(essential, []).releaseState).toBe("awaiting_review"));
  it("refuses a wrong unit, an unknown analyte, a duplicate, indeterminate text and a missing value", () => {
    const code = (items: LabItemInput[]) => { try { classifyLabResult(annual, items); return "ok"; } catch (e) { return e instanceof LabEntryError ? e.code : "other"; } };
    expect(code([{ analyteCode: "creatinine", valueNumeric: 90, unit: "umol/L" }])).toBe("lab_unit_mismatch");
    expect(code([{ analyteCode: "nonsense", valueNumeric: 1 }])).toBe("lab_unknown_analyte");
    expect(code([{ analyteCode: "alt", valueNumeric: 1 }, { analyteCode: "alt", valueNumeric: 2 }])).toBe("lab_duplicate_analyte");
    expect(code([{ analyteCode: "hbsag", valueText: "indeterminate" }])).toBe("lab_value_not_recognised");
    expect(code([{ analyteCode: "alt" }])).toBe("lab_value_missing");
    expect(code([{ analyteCode: "alt", valueNumeric: -1 }])).toBe("lab_value_out_of_bounds");
  });
  it("a withheld or held result never allows an explanation", () => {
    expect(explanationAllowed([], "awaiting_review")).toBe(false);
    expect(explanationAllowed([], "withheld")).toBe(false);
  });
});
