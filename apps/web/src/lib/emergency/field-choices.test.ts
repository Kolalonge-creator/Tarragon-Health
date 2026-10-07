import type { EmergencyClinicalFacts } from "./card";
import { CARD_FIELDS, DEFAULT_CHOICES, MINIMAL_CHOICES, applyCardFieldChoices, choicesFromRow, hiddenFields, rowFromChoices } from "./field-choices";

const FACTS: EmergencyClinicalFacts = {
  full_name: "Ada Okafor",
  date_of_birth: "1980-02-01",
  sex: "female",
  patient_number: "TH-000057",
  emergency_contact: { name: "Chi", phone: "+2348012345678", relationship: "sister" },
  allergies: [{ allergen: "Penicillin", reaction: "hives", severity: "severe" }],
  medications: [{ drug_name: "Metformin", dose: "500 mg", frequency: "twice daily" }],
  conditions: ["diabetes"],
  blood: { blood_group: "O+", genotype: "AA", note: null, provenance: "lab_document", recorded_at: null },
};

describe("applyCardFieldChoices", () => {
  it("changes nothing before the person has chosen", () => {
    expect(applyCardFieldChoices(FACTS, DEFAULT_CHOICES)).toEqual(FACTS);
  });

  it("the minimum keeps blood, allergies and the emergency contact and nothing else", () => {
    const out = applyCardFieldChoices(FACTS, MINIMAL_CHOICES);
    expect(out.blood).not.toBeNull();
    expect(out.allergies).toHaveLength(1);
    expect(out.emergency_contact).not.toBeNull();
    expect(out.date_of_birth).toBeNull();
    expect(out.sex).toBeNull();
    expect(out.patient_number).toBeNull();
    expect(out.medications).toEqual([]);
    expect(out.conditions).toEqual([]);
  });

  it("always keeps the name", () => {
    const none = Object.fromEntries(CARD_FIELDS.map((f) => [f, false])) as unknown as typeof DEFAULT_CHOICES;
    expect(applyCardFieldChoices(FACTS, { ...none, lock_screen_opt_in: false }).full_name).toBe("Ada Okafor");
  });

  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(FACTS));
    applyCardFieldChoices(FACTS, MINIMAL_CHOICES);
    expect(FACTS).toEqual(copy);
  });
});

describe("choices and rows", () => {
  it("round trip", () => {
    expect(choicesFromRow(rowFromChoices(MINIMAL_CHOICES))).toEqual(MINIMAL_CHOICES);
  });
  it("a missing row reads as the unchanged default, and lock screen presence is off by default", () => {
    expect(choicesFromRow(null)).toEqual(DEFAULT_CHOICES);
    expect(DEFAULT_CHOICES.lock_screen_opt_in).toBe(false);
    expect(MINIMAL_CHOICES.lock_screen_opt_in).toBe(false);
  });
  it("lists what is hidden", () => {
    expect(hiddenFields(DEFAULT_CHOICES)).toEqual([]);
    expect(hiddenFields(MINIMAL_CHOICES)).toEqual(["date_of_birth", "sex", "patient_number", "medications", "conditions"]);
  });
});
