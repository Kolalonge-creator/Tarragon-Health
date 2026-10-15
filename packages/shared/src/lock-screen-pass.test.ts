import { describe, expect, it } from "@jest/globals";
import { buildLockScreenPayload, LOCK_SCREEN_FIELDS, UNLOCK_HINT } from "./lock-screen-pass";

const SIGNED = {
  enabled: true,
  fields_signed: true,
  fields: [...LOCK_SCREEN_FIELDS],
  initials: "AB",
  blood_group: "O+",
  genotype: "AS",
  genotype_provenance: "patient_attested",
  allergies_on_file: true,
  emergency_contact_phone: "+2348012345678",
};

const FORBIDDEN = ["penicillin", "metformin", "amlodipine", "hypertension", "diabetes", "sickle", "peanut", "HIV", "pregnan"];

describe("buildLockScreenPayload", () => {
  it("carries exactly the approved fields", () => {
    const p = buildLockScreenPayload(SIGNED);
    expect(p?.rows.map((r) => r.key)).toEqual([...LOCK_SCREEN_FIELDS]);
    expect(p?.rows.find((r) => r.key === "allergies_on_file")?.value).toBe("Allergies on file");
    expect(p?.rows.find((r) => r.key === "unlock_hint")?.value).toBe(UNLOCK_HINT);
    expect(p?.rows.find((r) => r.key === "genotype_provenance")?.value).toBe("Told to us by you");
  });

  it("contains no medicine, condition or allergen name even when the caller leaks them", () => {
    const leaky = {
      ...SIGNED,
      allergies_on_file: "penicillin, peanut",
      medications: ["metformin", "amlodipine"],
      conditions: ["hypertension", "diabetes"],
      allergens: ["penicillin"],
      notes: "HIV positive, pregnant",
      blood_group: "penicillin",
      genotype: "sickle cell",
      emergency_contact_phone: "call mum on 0801 234 5678 about the diabetes",
    } as unknown as Parameters<typeof buildLockScreenPayload>[0];
    const text = JSON.stringify(buildLockScreenPayload(leaky));
    for (const word of FORBIDDEN) expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    // the allergies line is dropped, not echoed, because it was not the boolean true
    expect(text).not.toContain("Allergies on file");
    // a blood group or genotype that is not a real value is dropped
    expect(text).not.toContain("Blood group");
    expect(text).not.toContain("Genotype");
  });

  it("is off by default and reveals nothing", () => {
    expect(buildLockScreenPayload({ ...SIGNED, enabled: false })).toBeNull();
    expect(buildLockScreenPayload(null)).toBeNull();
    expect(buildLockScreenPayload(undefined)).toBeNull();
  });

  it("fails closed for a device or wallet surface until the CMO has signed the field list", () => {
    expect(buildLockScreenPayload({ ...SIGNED, fields_signed: false })).toBeNull();
    expect(buildLockScreenPayload({ ...SIGNED, fields_signed: undefined })).toBeNull();
  });

  it("lets the patient's own printed card through before signing", () => {
    expect(buildLockScreenPayload({ ...SIGNED, fields_signed: false }, { requireSigned: false })).not.toBeNull();
  });

  it("fails closed when the response carries no governed field list", () => {
    expect(buildLockScreenPayload({ ...SIGNED, fields: undefined })).toBeNull();
    expect(buildLockScreenPayload({ ...SIGNED, fields: [] })).toBeNull();
  });

  it("honours a narrower governed field list", () => {
    const p = buildLockScreenPayload({ ...SIGNED, fields: ["initials", "unlock_hint"] });
    expect(p?.rows.map((r) => r.key)).toEqual(["initials", "unlock_hint"]);
  });

  it("drops the provenance badge when there is no blood group or genotype to attach it to", () => {
    const p = buildLockScreenPayload({ ...SIGNED, blood_group: undefined, genotype: undefined });
    expect(p?.rows.map((r) => r.key)).not.toContain("genotype_provenance");
  });

  it("rejects free text under an allowed key", () => {
    const p = buildLockScreenPayload({ ...SIGNED, initials: "Ada Bello, on metformin" });
    expect(p?.rows.map((r) => r.key)).not.toContain("initials");
    expect(JSON.stringify(p)).not.toContain("metformin");
  });
});
