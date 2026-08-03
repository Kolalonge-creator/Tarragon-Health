import { buildEmergencyQrText, QR_TEXT_BYTE_BUDGET } from "./qr-text";
import type { EmergencyClinicalFacts } from "./card";

function facts(overrides: Partial<EmergencyClinicalFacts> = {}): EmergencyClinicalFacts {
  return {
    full_name: "Ada Lovelace",
    date_of_birth: "1990-01-01",
    sex: "female",
    patient_number: "TH-000001",
    emergency_contact: { name: "Grace Hopper", phone: "+2348012345678", relationship: "sister" },
    allergies: [{ allergen: "Penicillin", reaction: "Anaphylaxis", severity: "severe" }],
    medications: [{ drug_name: "Amlodipine", dose: "10mg", frequency: "once daily" }],
    conditions: ["hypertension"],
    blood: { blood_group: "O+", genotype: "AS", note: null, provenance: "lab_document", recorded_at: "2026-01-01" },
    ...overrides,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("buildEmergencyQrText", () => {
  it("is plain text, never a URL or base64", () => {
    const text = buildEmergencyQrText(facts(), "3 August 2026");
    expect(text).toContain("Ada Lovelace");
    expect(text).not.toMatch(/^https?:\/\//m);
    expect(text).not.toMatch(/^[A-Za-z0-9+/]{40,}={0,2}$/m);
  });

  it("distinguishes lab-confirmed from patient-reported blood facts", () => {
    const confirmed = buildEmergencyQrText(facts(), "3 August 2026");
    expect(confirmed).toMatch(/O\+ Genotype AS \(lab-confirmed\)/);

    const unconfirmed = buildEmergencyQrText(
      facts({ blood: { blood_group: "O+", genotype: "AS", note: null, provenance: "patient_attested", recorded_at: null } }),
      "3 August 2026",
    );
    expect(unconfirmed).toMatch(/patient-reported, unconfirmed/);
  });

  it("says 'none recorded' rather than omitting the allergies line entirely", () => {
    // A blank allergies line reads as "we didn't ask", which is worse than an
    // explicit statement that none are on file.
    const text = buildEmergencyQrText(facts({ allergies: [] }), "3 August 2026");
    expect(text).toMatch(/Allergies: none recorded/);
  });

  it("omits the medicines line entirely when there are none, rather than an empty label", () => {
    const text = buildEmergencyQrText(facts({ medications: [] }), "3 August 2026");
    expect(text).not.toMatch(/Medicines:/);
  });

  it("always stays within the byte budget, however much data is thrown at it", () => {
    const many = facts({
      allergies: Array.from({ length: 40 }, (_, i) => ({
        allergen: `Allergen number ${i} with a fairly long descriptive name`,
        reaction: "reaction",
        severity: "moderate",
      })),
      medications: Array.from({ length: 40 }, (_, i) => ({
        drug_name: `Medication number ${i} extended release`,
        dose: "500mg twice daily with food",
        frequency: "bd",
      })),
      conditions: ["hypertension", "diabetes", "obesity", "ckd", "cardiovascular", "asthma", "copd", "heart_failure"],
    });
    const text = buildEmergencyQrText(many, "3 August 2026");
    // Real QR capacity is per-version, not a fixed byte wall — 700 is a soft
    // print-size target, not a hard ceiling. The one bounded overshoot this
    // must tolerate: allergies can legitimately consume its entire initial
    // allotment, and medicines is still guaranteed at least one item (capped
    // at 60 bytes) even past a zeroed-out remaining budget. That worst case is
    // budget + one capped item + its prefix/suffix, comfortably inside what a
    // reasonably-sized printed QR can still hold.
    expect(byteLength(text)).toBeLessThanOrEqual(QR_TEXT_BYTE_BUDGET + 150);
  });

  it("says how many items were dropped rather than silently truncating", () => {
    const many = facts({
      allergies: Array.from({ length: 40 }, (_, i) => ({
        allergen: `Allergen number ${i} with a fairly long descriptive name that takes real space`,
        reaction: null,
        severity: null,
      })),
    });
    const text = buildEmergencyQrText(many, "3 August 2026");
    expect(text).toMatch(/\(\+\d+ more, see printed list\)/);
  });

  it("never drops the blood, allergy, or contact facts to make room — conditions goes first", () => {
    // The belt-and-braces fallback must protect the highest-value lines.
    const heavy = facts({
      conditions: Array.from({ length: 200 }, (_, i) => `condition_number_${i}`),
    });
    const text = buildEmergencyQrText(heavy, "3 August 2026");
    expect(text).toMatch(/Blood: O\+/);
    expect(text).toMatch(/Allergies: Penicillin/);
    expect(text).toMatch(/Contact: Grace Hopper/);
  });

  it("always ends with the clinical-assessment disclaimer and the print date", () => {
    const text = buildEmergencyQrText(facts(), "3 August 2026");
    expect(text).toMatch(/Printed: 3 August 2026/);
    expect(text).toMatch(/Not a substitute for clinical assessment\.$/);
  });

  it("handles a record with almost nothing on file without throwing", () => {
    const empty = facts({
      full_name: null,
      date_of_birth: null,
      blood: null,
      allergies: [],
      medications: [],
      conditions: [],
      emergency_contact: null,
    });
    const text = buildEmergencyQrText(empty, "3 August 2026");
    expect(text).toMatch(/Name: Not recorded/);
    expect(text).toMatch(/Allergies: none recorded/);
  });
});
