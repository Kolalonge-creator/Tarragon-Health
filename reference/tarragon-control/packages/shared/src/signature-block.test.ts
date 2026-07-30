import { describe, expect, it } from "vitest";
import { renderClinicianSignatureBlock } from "./signature-block";

describe("renderClinicianSignatureBlock (spec §4)", () => {
  it("renders the tech_layer variant: own MDCN registration", () => {
    const result = renderClinicianSignatureBlock({
      clinicianName: "Dr A. Adetunbi",
      mdcnNumber: "MDCN-12345",
      accountabilityModel: "tech_layer",
    });
    expect(result).toBe(
      "Dr A. Adetunbi · MDCN MDCN-12345 · practising under own registration",
    );
  });

  it("renders the provider variant: on behalf of Tarragon Health Ltd", () => {
    const result = renderClinicianSignatureBlock({
      clinicianName: "Dr A. Adetunbi",
      mdcnNumber: "MDCN-12345",
      accountabilityModel: "provider",
    });
    expect(result).toBe(
      "Dr A. Adetunbi · MDCN MDCN-12345 · on behalf of Tarragon Health Ltd",
    );
  });

  it("always includes the clinician name and MDCN number under both models (spec §10: on every message)", () => {
    for (const accountabilityModel of ["tech_layer", "provider"] as const) {
      const result = renderClinicianSignatureBlock({
        clinicianName: "Dr B. Okafor",
        mdcnNumber: "MDCN-99999",
        accountabilityModel,
      });
      expect(result).toContain("Dr B. Okafor");
      expect(result).toContain("MDCN-99999");
    }
  });
});
