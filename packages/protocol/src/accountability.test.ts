import { describe, expect, it } from "@jest/globals";
import { getSignatureBlock } from "./accountability";

describe("getSignatureBlock", () => {
  const clinician = { fullName: "A. Adetunbi", mdcnNumber: "12345" };

  it("renders the tech_layer disclosure — own registration, no mention of Tarragon", () => {
    const block = getSignatureBlock(clinician, "tech_layer");
    expect(block.clinicianLine).toBe("Dr A. Adetunbi — MDCN 12345");
    expect(block.disclosureLine).toBe("practising under own registration");
    expect(block.fullText).not.toMatch(/Tarragon/);
  });

  it("renders the provider disclosure — on behalf of Tarragon Health Ltd", () => {
    const block = getSignatureBlock(clinician, "provider");
    expect(block.disclosureLine).toBe("on behalf of Tarragon Health Ltd");
    expect(block.fullText).toContain("Tarragon Health Ltd");
  });

  it("always includes the clinician name and MDCN number regardless of model", () => {
    for (const model of ["tech_layer", "provider"] as const) {
      const block = getSignatureBlock(clinician, model);
      expect(block.fullText).toContain("A. Adetunbi");
      expect(block.fullText).toContain("12345");
    }
  });
});
