import { BLOOD_VERIFICATION_LABEL, bloodVerificationFromProvenance } from "@tarragon/shared";
import { BLOOD_PROVENANCE } from "./card";

describe("emergency card blood labels (S05b)", () => {
  it("uses the two approved words and matches the shared mapping", () => {
    expect(BLOOD_PROVENANCE.lab_document.label).toBe(BLOOD_VERIFICATION_LABEL[bloodVerificationFromProvenance("lab_document")]);
    expect(BLOOD_PROVENANCE.patient_attested.label).toBe(BLOOD_VERIFICATION_LABEL[bloodVerificationFromProvenance("patient_attested")]);
    expect(BLOOD_PROVENANCE.lab_document.label).toBe("Verified by a lab");
    expect(BLOOD_PROVENANCE.patient_attested.label).toBe("Self-reported");
  });
  it("keeps the self-reported caution tone", () => {
    expect(BLOOD_PROVENANCE.patient_attested.tone).toBe("unconfirmed");
  });
});
