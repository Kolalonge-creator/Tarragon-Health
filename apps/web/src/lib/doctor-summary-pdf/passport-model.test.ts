import { buildGlucoseSection, buildLabSection, PASSPORT_LAB_CODES, type LabReadingIn } from "./passport-model";
import { PASSPORT_SECTION_KEYS, SECTION_KEYS, VISIT_SECTION_KEYS, usesPassportSections } from "./model";

const helpers = { showRange: (s: string | null) => s === "laboratory", describe: () => "range set by the laboratory" };
const lab = (over: Partial<LabReadingIn>): LabReadingIn => ({
  code: "hba1c", value: 6.9, valueText: null, unit: "%", referenceRangeText: "4.0 to 5.6", rangeSource: "laboratory", rangeSourceRef: null,
  abnormalFlag: null, takenAt: "2026-09-30T08:00:00Z", laboratory: "Lab A", sensitivePositive: false, ...over,
});

describe("section keys", () => {
  it("keeps the visit sections as they were and adds exactly the two passport sections", () => {
    expect([...VISIT_SECTION_KEYS]).toEqual(["bp", "bp_chart", "medicines", "adherence", "skipped", "symptoms", "allergies_conditions"]);
    expect([...PASSPORT_SECTION_KEYS]).toEqual(["glucose", "lab_results"]);
    expect(SECTION_KEYS).toHaveLength(9);
  });
  it("knows when a request needs the guard", () => {
    expect(usesPassportSections(["bp", "medicines"])).toBe(false);
    expect(usesPassportSections(["bp", "glucose"])).toBe(true);
    expect(usesPassportSections(["lab_results"])).toBe(true);
  });
});

describe("buildGlucoseSection", () => {
  const r = (takenAt: string, mmolL: number | null, over = {}) => ({ takenAt, mmolL, context: "fasting", source: "manual", validationStatus: "valid", ...over });
  it("lists newest first with both units, and gives a range but no average and no verdict", () => {
    const s = buildGlucoseSection([r("2026-10-01T06:00:00Z", 5.5), r("2026-10-03T06:00:00Z", 9.9, { context: "post_meal" }), r("2026-10-02T06:00:00Z", 7.2)]);
    expect(s.lines.map((l) => l.mmolL)).toEqual([9.9, 7.2, 5.5]);
    expect(s.lines[0]).toMatchObject({ mgDl: 178, context: "after a meal" });
    expect(s.lowest).toBe(5.5);
    expect(s.highest).toBe(9.9);
    expect(Object.keys(s)).not.toContain("average");
    expect(JSON.stringify(s)).not.toMatch(/average|controlled|target/i);
  });
  it("does not count a reading that did not pass validation or has no value", () => {
    const s = buildGlucoseSection([r("2026-10-01T06:00:00Z", 2.0, { validationStatus: "rejected" }), r("2026-10-02T06:00:00Z", null), r("2026-10-03T06:00:00Z", 6.1)]);
    expect(s.totalListed).toBe(1);
    expect(s.notCounted).toBe(2);
    expect(s.lowest).toBe(6.1);
  });
  it("labels a wearable or imported source and says when the list is cut", () => {
    const rows = Array.from({ length: 5 }, (_, i) => r(`2026-10-0${i + 1}T06:00:00Z`, 6 + i, { source: i === 0 ? "wearable" : "manual" }));
    const s = buildGlucoseSection(rows, 3);
    expect(s.lines).toHaveLength(3);
    expect(s.truncated).toBe(true);
    expect(buildGlucoseSection(rows).lines.find((l) => l.trust === "wearable")).toBeDefined();
  });
});

describe("buildLabSection", () => {
  it("takes the newest result of each test, in label order", () => {
    const s = buildLabSection([lab({ value: 7.4, takenAt: "2026-05-01T08:00:00Z" }), lab({ value: 6.9 }), lab({ code: "creatinine", value: 82, unit: "umol/L", referenceRangeText: null })], helpers);
    expect(s.lines.map((l) => [l.label, l.result])).toEqual([["Creatinine", "82 umol/L"], ["HbA1c", "6.9 %"]]);
  });
  it("shows a range only when its source may be shown as clinical", () => {
    const s = buildLabSection([lab({}), lab({ code: "creatinine", rangeSource: "unknown", referenceRangeText: "60 to 110" })], helpers);
    expect(s.lines.find((l) => l.label === "HbA1c")?.range).toEqual({ text: "4.0 to 5.6", source: "range set by the laboratory" });
    expect(s.lines.find((l) => l.label === "Creatinine")?.range).toBeNull();
  });
  it("never prints a sensitive positive result, even one that reached it by mistake, and does not count it as left out", () => {
    const s = buildLabSection([lab({ code: "hbsag", valueText: "Reactive", value: null, sensitivePositive: true }), lab({ code: "hivag", sensitivePositive: true }), lab({})], helpers);
    expect(JSON.stringify(s)).not.toMatch(/hbsag|hivag|reactive/i);
    expect(s.leftOut).toBe(0);
  });
  it("leaves out any analyte that is not on the allow-list (reproductive hormones, infection screens, anything new) and says how many kinds", () => {
    const s = buildLabSection([lab({}), lab({ code: "hcg_quantitative" }), lab({ code: "fsh" }), lab({ code: "some_new_code" })], helpers);
    expect(s.lines.map((l) => l.label)).toEqual(["HbA1c"]);
    expect(s.leftOut).toBe(3);
  });
  it("has no reproductive, pregnancy, hormone or infection code on the allow-list", () => {
    expect(PASSPORT_LAB_CODES.join(",")).not.toMatch(/hcg|preg|fsh|lh|estr|prog|testo|prolactin|amh|psa|hiv|hbs|hcv|syph|chlam|gonor|anti_hbs/i);
  });
});
