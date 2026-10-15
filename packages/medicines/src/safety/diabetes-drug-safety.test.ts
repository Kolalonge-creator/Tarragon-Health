import { classifyDiabetesDrug, diabetesDrugSafety } from "./diabetes-drug-safety";

describe("classifyDiabetesDrug", () => {
  it("classifies common drugs by name", () => {
    expect(classifyDiabetesDrug("Metformin 500mg")).toBe("metformin");
    expect(classifyDiabetesDrug("Gliclazide MR")).toBe("sulfonylurea");
    expect(classifyDiabetesDrug("empagliflozin")).toBe("sglt2");
    expect(classifyDiabetesDrug("Sitagliptin")).toBe("dpp4");
    expect(classifyDiabetesDrug("Insulin (NPH)")).toBe("insulin");
    expect(classifyDiabetesDrug("Ramipril")).toBe("ace_arb");
  });

  it("returns null for an unrelated / empty drug", () => {
    expect(classifyDiabetesDrug("Paracetamol")).toBeNull();
    expect(classifyDiabetesDrug("")).toBeNull();
  });
});

describe("diabetesDrugSafety", () => {
  it("contraindicates metformin at eGFR < 30", () => {
    const w = diabetesDrugSafety("Metformin", { egfr: 22 });
    expect(w.some((x) => x.severity === "contraindicated")).toBe(true);
  });

  it("cautions metformin at eGFR 30–45 (not contraindicated)", () => {
    const w = diabetesDrugSafety("Metformin", { egfr: 40 });
    expect(w.some((x) => x.severity === "contraindicated")).toBe(false);
    expect(w.some((x) => x.severity === "caution")).toBe(true);
  });

  it("still gives general metformin cautions when eGFR is unknown (never a false 'safe')", () => {
    const w = diabetesDrugSafety("Metformin", {});
    expect(w.length).toBeGreaterThan(0);
    // no eGFR-specific contraindication without data
    expect(w.some((x) => x.message.includes("eGFR < 30"))).toBe(false);
  });

  it("flags SGLT2 sick-day stop (euglycaemic DKA)", () => {
    const w = diabetesDrugSafety("dapagliflozin", { acutelyUnwell: true });
    expect(w.some((x) => /euglycaemic DKA/i.test(x.message))).toBe(true);
    expect(w.some((x) => /hold the SGLT2/i.test(x.message))).toBe(true);
  });

  it("prefers gliclazide over glibenclamide", () => {
    const w = diabetesDrugSafety("Glibenclamide");
    expect(w.some((x) => /prefer gliclazide/i.test(x.message))).toBe(true);
  });

  it("contraindicates sulfonylurea and ACE/ARB in pregnancy", () => {
    expect(diabetesDrugSafety("Gliclazide", { pregnant: true }).some((x) => x.severity === "contraindicated")).toBe(true);
    expect(diabetesDrugSafety("Ramipril", { pregnant: true }).some((x) => x.severity === "contraindicated")).toBe(true);
  });

  it("reminds never to stop insulin in T1DM", () => {
    const w = diabetesDrugSafety("Insulin");
    expect(w.some((x) => /never stop insulin/i.test(x.message))).toBe(true);
  });

  it("returns nothing for an unrelated drug", () => {
    expect(diabetesDrugSafety("Amoxicillin")).toEqual([]);
  });
});
