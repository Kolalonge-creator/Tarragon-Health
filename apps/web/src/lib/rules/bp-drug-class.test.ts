import { bpDrugClass, inferBpLadderStep } from "./bp-drug-class";

describe("bpDrugClass (must match private.bp_drug_class)", () => {
  it("classifies the HEARTS formulary", () => {
    expect(bpDrugClass("Losartan 50mg")).toBe("arb");
    expect(bpDrugClass("Telmisartan 40mg")).toBe("arb");
    expect(bpDrugClass("Ramipril 5mg")).toBe("acei");
    expect(bpDrugClass("Amlodipine 10mg")).toBe("ccb");
    expect(bpDrugClass("Hydrochlorothiazide 25mg")).toBe("thiazide");
    expect(bpDrugClass("Spironolactone 25mg")).toBe("k_sparing");
    expect(bpDrugClass("Paracetamol")).toBeNull();
    expect(bpDrugClass(null)).toBeNull();
  });
});

describe("inferBpLadderStep", () => {
  it("maps class combinations to a ladder step", () => {
    expect(inferBpLadderStep([])).toBe(0);
    expect(inferBpLadderStep(["Amlodipine 5mg"])).toBe(1);
    expect(inferBpLadderStep(["Amlodipine 5mg", "Losartan 50mg"])).toBe(3);
    expect(inferBpLadderStep(["Amlodipine 10mg", "Losartan 100mg", "Hydrochlorothiazide 25mg"])).toBe(4);
    expect(inferBpLadderStep(["Amlodipine 10mg", "Losartan 100mg", "Spironolactone 25mg"])).toBe(5);
    expect(inferBpLadderStep(["Paracetamol"])).toBe(0);
  });
});
