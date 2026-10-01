import {
  ageInYears,
  buildPrescriptionBundle,
  buildPrescriptionPdfData,
  isPlaceholderCredentialNumber,
  REFUSAL_MESSAGE,
  type PrescriptionPrescriber,
  type PrescriptionSource,
} from "./prescription-pdf-data";

const NOW = new Date("2026-10-01T12:00:00Z");

const medication: PrescriptionSource = {
  id: "11111111-1111-4111-8111-111111111111",
  patient_id: "22222222-2222-4222-8222-222222222222",
  source: "clinician",
  is_active: true,
  drug_name: "Amlodipine",
  dose: "5 mg",
  frequency: "Once daily",
  route: "Oral",
  quantity: "30 tablets",
  duration_days: 30,
  repeats_allowed: 2,
  indication: "Hypertension",
  instructions: "Take in the morning",
  rx_number: "TRG-RX-2026-000366",
  verification_code: "A1B2C3",
  expires_at: "2027-04-01T00:00:00Z",
  version: 1,
  superseded_at: null,
  created_at: "2026-10-01T09:00:00Z",
  amendment_reason: null,
  public_token: "a".repeat(64),
};
const patient = { full_name: "First Patient", patient_number: "TH-002610", date_of_birth: "1985-03-04" };
const prescriber: PrescriptionPrescriber = {
  name: "Ada Longe",
  credentialType: "MDCN",
  credentialNumber: "123456",
  licenseVerified: true,
};

function build(overrides: Partial<PrescriptionSource> = {}, who: PrescriptionPrescriber | null = prescriber) {
  return buildPrescriptionPdfData({ medication: { ...medication, ...overrides }, patient, prescriber: who, now: NOW });
}

describe("buildPrescriptionPdfData", () => {
  it("issues a current clinician prescription with every identifier", () => {
    const result = build();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data).toMatchObject({
      drugName: "Amlodipine",
      dose: "5 mg",
      rxNumber: "TRG-RX-2026-000366",
      verificationCode: "A1B2C3",
      repeatsAllowed: 2,
      prescriberName: "Ada Longe",
      prescriberCredential: "MDCN 123456",
      patientNumber: "TH-002610",
      publicToken: "a".repeat(64),
    });
  });

  it("prints zero repeats when none were allowed, never null", () => {
    const result = build({ repeats_allowed: null });
    expect(result.status === "ok" && result.data.repeatsAllowed).toBe(0);
  });

  it("carries the amendment reason only for a later version", () => {
    const amended = build({ version: 2, amendment_reason: "Dose reduced" });
    expect(amended.status === "ok" && amended.data.amendmentReason).toBe("Dose reduced");
    const first = build({ version: 1, amendment_reason: "stale" });
    expect(first.status === "ok" && first.data.amendmentReason).toBeNull();
  });

  const refusals: [string, Partial<PrescriptionSource>, string][] = [
    ["patient-added medicine", { source: "patient" }, "not_prescribed_by_clinician"],
    ["specialist-sourced medicine", { source: "specialist" }, "not_prescribed_by_clinician"],
    ["stopped medicine", { is_active: false }, "stopped"],
    ["superseded prescription", { superseded_at: "2026-09-30T00:00:00Z", is_active: false }, "superseded"],
    ["expired prescription", { expires_at: "2026-09-30T00:00:00Z" }, "expired"],
    ["missing Rx number", { rx_number: null }, "missing_identifiers"],
    ["missing verification code", { verification_code: null }, "missing_identifiers"],
    ["controlled opioid", { drug_name: "Tramadol 50 mg" }, "controlled_medicine"],
    ["benzodiazepine", { drug_name: "Diazepam" }, "controlled_medicine"],
  ];
  it.each(refusals)("refuses a %s", (_label, overrides, reason) => {
    const result = build(overrides);
    expect(result).toEqual({ status: "refused", reason, message: REFUSAL_MESSAGE[reason as keyof typeof REFUSAL_MESSAGE] });
  });

  it("refuses when the prescriber record is missing, unverified or carries a placeholder number", () => {
    expect(build({}, null)).toMatchObject({ status: "refused", reason: "prescriber_unverified" });
    expect(build({}, { ...prescriber, licenseVerified: false })).toMatchObject({ reason: "prescriber_unverified" });
    expect(build({}, { ...prescriber, credentialNumber: "MDCN-PENDING-ab12" })).toMatchObject({ reason: "prescriber_unverified" });
    expect(build({}, { ...prescriber, credentialNumber: null })).toMatchObject({ reason: "prescriber_unverified" });
    expect(build({}, { ...prescriber, credentialType: null })).toMatchObject({ reason: "prescriber_unverified" });
    expect(build({}, { ...prescriber, name: null })).toMatchObject({ reason: "prescriber_unverified" });
  });

  it("still issues when the prescription has no expiry stamp", () => {
    expect(build({ expires_at: null }).status).toBe("ok");
  });

  it("reports superseded rather than stopped for an amended row", () => {
    expect(build({ superseded_at: "2026-09-30T00:00:00Z", is_active: false })).toMatchObject({ reason: "superseded" });
  });
});

describe("isPlaceholderCredentialNumber", () => {
  it.each(["", "  ", "MDCN-PENDING-123", "TBC", "n/a", "test-1", "Unknown"])("treats %j as a placeholder", (value) => {
    expect(isPlaceholderCredentialNumber(value)).toBe(true);
  });
  it("accepts a real number and does not treat null as real", () => {
    expect(isPlaceholderCredentialNumber("MDCN/R/45219")).toBe(false);
    expect(isPlaceholderCredentialNumber("MDCN-ATTESTA-7")).toBe(false);
    expect(isPlaceholderCredentialNumber(null)).toBe(true);
  });
});

describe("buildPrescriptionBundle", () => {
  it("separates the issuable prescriptions from the refused ones", () => {
    const good = build();
    const bad = build({ is_active: false });
    const { included, refused } = buildPrescriptionBundle([good, bad]);
    expect(included).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBe("stopped");
  });
});

describe("ageInYears", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("counts whole years and the birthday not yet reached", () => {
    expect(ageInYears("1985-03-04", now)).toBe(41);
    expect(ageInYears("1985-10-02", now)).toBe(40);
    expect(ageInYears("1985-10-01", now)).toBe(41);
  });
  it("is null for a missing, unparseable, future or implausible date", () => {
    for (const bad of [null, undefined, "", "not a date", "2030-01-01", "1800-01-01"]) expect(ageInYears(bad, now)).toBeNull();
  });
  it("is carried onto the document data with the sex", () => {
    const result = buildPrescriptionPdfData({ medication, patient: { ...patient, sex: "female" }, prescriber, now });
    expect(result.status === "ok" && [result.data.patientAge, result.data.patientSex]).toEqual([41, "female"]);
  });
});
