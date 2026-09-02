import {
  declineVaccinationSchema,
  logVaccinationSchema,
  markVaccinationContraindicatedSchema,
  reportVaccinationAdverseEventSchema,
  validateCertificateFile,
  vaccinationVerificationDecisionSchema,
} from "./vaccination";

function fakeFile(type: string, sizeBytes: number): File {
  // A File whose reported size we control without allocating the bytes.
  const file = new File(["x"], "cert", { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("validateCertificateFile", () => {
  it("accepts a normal-sized image", () => {
    expect(validateCertificateFile(fakeFile("image/jpeg", 2 * 1024 * 1024))).toBeNull();
  });

  it("accepts a PDF", () => {
    expect(validateCertificateFile(fakeFile("application/pdf", 1024))).toBeNull();
  });

  it("rejects an unsupported type", () => {
    expect(validateCertificateFile(fakeFile("text/plain", 1024))).toMatch(/photo|PDF/i);
  });

  it("rejects a file over 10 MB", () => {
    expect(validateCertificateFile(fakeFile("image/png", 11 * 1024 * 1024))).toMatch(/10 MB/);
  });
});

describe("vaccinationVerificationDecisionSchema", () => {
  const recordId = "11111111-1111-4111-8111-111111111111";

  it("accepts a verified decision with a note", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: recordId,
      decision: "verified",
      note: "Certificate legible, matches record",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: recordId,
      decision: "maybe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid record id", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: "not-a-uuid",
      decision: "rejected",
    });
    expect(result.success).toBe(false);
  });
});

const catalogId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";

describe("logVaccinationSchema", () => {
  it("accepts administration detail as optional", () => {
    const result = logVaccinationSchema.safeParse({
      vaccination_catalog_id: catalogId,
      dose_number: 1,
      date_administered: "2026-08-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated administration detail", () => {
    const result = logVaccinationSchema.safeParse({
      vaccination_catalog_id: catalogId,
      dose_number: 1,
      date_administered: "2026-08-01",
      batch_lot_number: "LOT-123",
      route: "intramuscular",
      site: "Left deltoid",
      location: "Reliance Family Clinic, Lekki",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognised route", () => {
    const result = logVaccinationSchema.safeParse({
      vaccination_catalog_id: catalogId,
      dose_number: 1,
      date_administered: "2026-08-01",
      route: "injection",
    });
    expect(result.success).toBe(false);
  });
});

describe("declineVaccinationSchema", () => {
  it("accepts a decline with no note", () => {
    const result = declineVaccinationSchema.safeParse({ patientId, vaccinationCatalogId: catalogId });
    expect(result.success).toBe(true);
  });
});

describe("markVaccinationContraindicatedSchema", () => {
  it("requires a note documenting the contraindication", () => {
    const result = markVaccinationContraindicatedSchema.safeParse({
      patientId,
      vaccinationCatalogId: catalogId,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a documented contraindication", () => {
    const result = markVaccinationContraindicatedSchema.safeParse({
      patientId,
      vaccinationCatalogId: catalogId,
      note: "Anaphylaxis to a prior dose",
    });
    expect(result.success).toBe(true);
  });
});

describe("reportVaccinationAdverseEventSchema", () => {
  it("requires at least one symptom", () => {
    const result = reportVaccinationAdverseEventSchema.safeParse({
      vaccinationRecordId: recordId,
      patientId,
      symptoms: [],
      severity: "mild",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed report", () => {
    const result = reportVaccinationAdverseEventSchema.safeParse({
      vaccinationRecordId: recordId,
      patientId,
      symptoms: ["fever", "pain_at_site"],
      severity: "moderate",
      description: "Felt feverish for a day",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognised symptom", () => {
    const result = reportVaccinationAdverseEventSchema.safeParse({
      vaccinationRecordId: recordId,
      patientId,
      symptoms: ["dizziness"],
      severity: "mild",
    });
    expect(result.success).toBe(false);
  });
});
