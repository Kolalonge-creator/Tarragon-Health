import { describe, expect, it } from "@jest/globals";
import {
  BLOOD_VERIFICATION_LABEL,
  CORRECTION_STATUSES,
  RANGE_SOURCES,
  bloodVerificationFromProvenance,
  rangeMayBeShownAsClinical,
  rangeSourceLabel,
} from "./record-integrity";

describe("blood verification", () => {
  it("is lab verified only for lab-backed provenance", () => {
    expect(bloodVerificationFromProvenance("lab_document")).toBe("lab_verified");
    expect(bloodVerificationFromProvenance("patient_attested")).toBe("self_reported");
    expect(bloodVerificationFromProvenance(null)).toBe("self_reported");
    expect(bloodVerificationFromProvenance("something_else")).toBe("self_reported");
  });
  it("uses the wording the founder approved", () => {
    expect(BLOOD_VERIFICATION_LABEL.self_reported).toBe("Self-reported");
    expect(BLOOD_VERIFICATION_LABEL.lab_verified).toBe("Verified by a lab");
  });
});

describe("correction statuses", () => {
  it("has the four agreed values", () => {
    expect([...CORRECTION_STATUSES]).toEqual(["corrected", "amended", "entered_in_error", "cancelled"]);
  });
});

describe("range source", () => {
  it("labels every source and never returns an empty label", () => {
    for (const s of [...RANGE_SOURCES, null, undefined, "bogus"]) {
      expect(rangeSourceLabel(s as string | null).length).toBeGreaterThan(0);
    }
    expect(rangeSourceLabel("lab_report")).toBe("Range from the lab report");
    expect(rangeSourceLabel("guideline", "ADA Standards of Care 2024")).toBe("Range from ADA Standards of Care 2024");
    expect(rangeSourceLabel("cmo_signed_config", "lab panel version 3")).toContain("signed by the Chief Medical Officer");
    expect(rangeSourceLabel("unspecified")).toBe("Range not specified");
    expect(rangeSourceLabel(null)).toBe("Range not specified");
  });
  it("refuses to treat an unspecified or unknown source as clinical", () => {
    expect(rangeMayBeShownAsClinical("unspecified")).toBe(false);
    expect(rangeMayBeShownAsClinical("optimal")).toBe(false);
    expect(rangeMayBeShownAsClinical(null)).toBe(false);
    expect(rangeMayBeShownAsClinical("guideline")).toBe(true);
  });
});
