import {
  CLINICAL_DOCUMENT_STATUSES,
  describeDocumentRefusal,
  isClinicalDocumentStatus,
  STAFF_STATUS_LABEL,
  STATUS_TONE,
} from "./status";

// The statuses the database CHECK allows (20261104160432_cde1_clinical_document_intake.sql). Keep in step with it.
const DB_STATUSES = [
  "uploaded",
  "processing",
  "processed",
  "awaiting_verification",
  "doctor_review_required",
  "reviewed",
  "processing_failed",
  "superseded",
];

describe("clinical document status words", () => {
  it("covers exactly the statuses the database allows", () => {
    expect([...CLINICAL_DOCUMENT_STATUSES].sort()).toEqual([...DB_STATUSES].sort());
    for (const s of DB_STATUSES) {
      expect(isClinicalDocumentStatus(s)).toBe(true);
      expect(STAFF_STATUS_LABEL[s as keyof typeof STAFF_STATUS_LABEL]).toBeTruthy();
      expect(STATUS_TONE[s as keyof typeof STATUS_TONE]).toBeTruthy();
    }
    expect(isClinicalDocumentStatus("normal")).toBe(false);
  });

  it("never says a doctor checked something unless a clinician acted", () => {
    for (const s of CLINICAL_DOCUMENT_STATUSES) {
      if (s === "reviewed") continue;
      expect(STAFF_STATUS_LABEL[s].toLowerCase()).not.toMatch(/checked by|reviewed by|doctor (has )?(checked|reviewed)/);
    }
    expect(STAFF_STATUS_LABEL.processed).toContain("not yet checked");
  });
});

describe("describeDocumentRefusal", () => {
  it("turns the identity refusals into instructions", () => {
    expect(describeDocumentRefusal({ message: "identity_date_of_birth_mismatch" }, "x")).toContain("Do not upload it");
    expect(describeDocumentRefusal({ message: "find_patient_name_needs_date_of_birth" }, "x")).toContain("date of birth");
    expect(describeDocumentRefusal({ message: "Not permitted" }, "x")).toBe("You do not have access to that.");
    expect(describeDocumentRefusal({ message: "something else" }, "fallback")).toBe("fallback");
  });
});
