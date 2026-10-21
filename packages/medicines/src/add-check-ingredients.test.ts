import { describe, expect, it } from "@jest/globals";
import { checkIngredientsOnAdd } from "./add-check-ingredients";
import type { BrandMapEntry } from "./brand-map";
import type { IngredientRule } from "./interaction-rules";

const brand: BrandMapEntry = {
  id: "1", brandName: "Examplebrand", ingredients: ["exampleone"], sourceCitation: "https://example.org/a",
  reviewedBy: "u", reviewerName: "A Pharmacist", reviewedAt: "2026-10-20T00:00:00Z", isActive: true,
};
const rule: IngredientRule = { code: "r1", ingredientA: "exampleone", ingredientB: "exampletwo", severity: "contraindicated", source: "https://example.org/s" };
const base = { brandMap: [brand], catalogue: [], duplicateCheck: true, rules: [] as IngredientRule[] };

describe("checkIngredientsOnAdd", () => {
  it("says nothing for a blank name", () => {
    expect(checkIngredientsOnAdd({ ...base, candidateName: "  ", existing: [{ id: "m", drugName: "Exampleone" }] }).findings).toEqual([]);
  });
  it("warns when a brand and a generic share an ingredient", () => {
    const r = checkIngredientsOnAdd({ ...base, candidateName: "Examplebrand", existing: [{ id: "m", drugName: "Exampleone" }, { id: "n", drugName: "Elsewise" }] });
    expect(r.findings).toEqual([
      { kind: "same_ingredient", severity: "caution", drugNames: ["Examplebrand", "Exampleone"], adviceKey: "medicines.addcheck.advice.same_ingredient" },
    ]);
    expect(r.isAdvisoryOnly).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.changesAnything).toBe(false);
  });
  it("ignores pairs that do not involve the new medicine", () => {
    const r = checkIngredientsOnAdd({ ...base, candidateName: "Elsewise", existing: [{ id: "m", drugName: "Exampleone" }, { id: "n", drugName: "Exampleone" }] });
    expect(r.findings).toEqual([]);
  });
  it("does not run the duplicate warning while its switch is closed", () => {
    const r = checkIngredientsOnAdd({ ...base, duplicateCheck: false, candidateName: "Exampleone", existing: [{ id: "m", drugName: "Exampleone" }] });
    expect(r.findings).toEqual([]);
  });
  it("adds signed rule findings, worst first", () => {
    const r = checkIngredientsOnAdd({
      ...base, rules: [rule], candidateName: "Exampletwo", existing: [{ id: "m", drugName: "Examplebrand" }, { id: "n", drugName: "Exampletwo" }],
    });
    expect(r.findings.map((f) => `${f.kind}:${f.severity}`)).toEqual(["rule:contraindicated", "same_ingredient:caution"]);
    expect(r.findings[0].drugNames).toEqual(["Exampletwo", "Examplebrand"]);
  });
});
