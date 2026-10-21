import type { EmergencyClinicalFacts } from "./card";
import { applyCardFieldChoices, DEFAULT_CHOICES, hiddenFields, MINIMAL_CHOICES, type CardFieldChoices } from "./field-choices";
import { buildLockScreenModel, lockScreenChoices, LOCK_SCREEN_IMAGE, LOCK_SCREEN_FILE_NAME, MAX_ROW_LINES } from "./lock-screen-image";

const facts: EmergencyClinicalFacts = {
  full_name: "Ada Obi",
  date_of_birth: "1984-03-02",
  sex: "female",
  patient_number: "TH-1",
  emergency_contact: { name: "Chidi Obi", phone: "+2348012345678", relationship: "Brother" },
  allergies: [{ allergen: "Penicillin", reaction: "Hives", severity: "severe" }],
  medications: [
    { drug_name: "Amlodipine", dose: "5 mg", frequency: "daily" },
    { drug_name: "Sertraline", dose: "50 mg", frequency: "daily" },
    { drug_name: "Levonorgestrel", dose: null, frequency: null },
  ],
  conditions: ["hypertension", "major depression"],
  blood: { blood_group: "O+", genotype: "AS", note: null, provenance: "patient_attested", recorded_at: null },
};

function model(choices: CardFieldChoices) {
  const applied = applyCardFieldChoices(facts, choices);
  return buildLockScreenModel(applied, hiddenFields(choices), "20 Oct 2026");
}

const text = (m: ReturnType<typeof model>) => JSON.stringify(m);

describe("lock screen picture choices", () => {
  it("is off by default (the option defaults to false in both presets)", () => {
    expect(DEFAULT_CHOICES.lock_screen_opt_in).toBe(false);
    expect(MINIMAL_CHOICES.lock_screen_opt_in).toBe(false);
  });

  it("the minimum can only narrow what the person chose, never widen it", () => {
    const chosenNarrow: CardFieldChoices = { ...MINIMAL_CHOICES, blood: false, lock_screen_opt_in: true };
    const out = lockScreenChoices(chosenNarrow, true);
    expect(out.blood).toBe(false); // not chosen, stays off even though the minimum includes it
    const everything: CardFieldChoices = { ...DEFAULT_CHOICES, conditions: true, reproductive: true, mental_health: true, lock_screen_opt_in: true };
    const min = lockScreenChoices(everything, true);
    expect(min).toMatchObject({ allergies: true, blood: true, emergency_contact: true, medications: false, conditions: false, date_of_birth: false, sex: false, patient_number: false, reproductive: false, mental_health: false, lock_screen_opt_in: true });
    // with the minimum off the person's own choices are used unchanged
    expect(lockScreenChoices(everything, false)).toEqual(everything);
  });
});

describe("buildLockScreenModel", () => {
  it("shows only what the person chose: a field switched off is not on the picture at all", () => {
    const m = model(lockScreenChoices({ ...DEFAULT_CHOICES, lock_screen_opt_in: true }, true));
    expect(m.rows.map((r) => r.key)).toEqual(["blood", "allergies", "emergency_contact"]);
    expect(text(m)).not.toMatch(/Amlodipine|hypertension|1984|female|TH-1/);
  });

  it("a detail the person chose not to share is said to be not shared, never none recorded", () => {
    const m = model(lockScreenChoices({ ...DEFAULT_CHOICES, lock_screen_opt_in: true }, true));
    expect(m.notShared).toBe("Not shared by the patient. Ask the patient or their family.");
    const all = model({ ...DEFAULT_CHOICES, conditions: true, reproductive: true, mental_health: true, lock_screen_opt_in: true });
    expect(all.notShared).toBeNull();
  });

  it("a withheld reproductive or mental health medicine is counted and never named", () => {
    const m = model({ ...DEFAULT_CHOICES, lock_screen_opt_in: true });
    const meds = m.rows.find((r) => r.key === "medications")!;
    expect(meds.lines[0]).toContain("Amlodipine");
    expect(meds.lines.join(" ")).toContain("2 medicines are not shown by the patient");
    expect(text(m)).not.toMatch(/Sertraline|Levonorgestrel/);
  });

  it("a sensitive condition is withheld unless its own switch is on, even when conditions are shown", () => {
    const m = model({ ...DEFAULT_CHOICES, conditions: true, lock_screen_opt_in: true });
    expect(text(m)).toContain("hypertension");
    expect(text(m)).not.toMatch(/depression/);
    const shown = model({ ...DEFAULT_CHOICES, conditions: true, mental_health: true, lock_screen_opt_in: true });
    expect(text(shown)).toMatch(/major depression/);
  });

  it("a patient-reported blood group is marked as a caution and never as a lab result", () => {
    const blood = model({ ...DEFAULT_CHOICES, lock_screen_opt_in: true }).rows.find((r) => r.key === "blood")!;
    expect(blood.tone).toBe("caution");
    expect(blood.lines.join(" ")).toMatch(/Self-reported|patient/i);
    expect(blood.lines.join(" ")).toContain("Always confirm by testing before transfusing.");
  });

  it("a severe allergy is an alert; an empty shown allergy list never reads as none", () => {
    const m = model({ ...DEFAULT_CHOICES, lock_screen_opt_in: true });
    expect(m.rows.find((r) => r.key === "allergies")!.tone).toBe("alert");
    const empty = buildLockScreenModel({ ...facts, allergies: [] }, [], "x");
    expect(empty.rows.find((r) => r.key === "allergies")!.lines[0]).toContain("That is not the same as none");
  });

  it("a long list is cut to fit and says how many were left off", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ allergen: `A${i}`, reaction: null, severity: null }));
    const m = buildLockScreenModel({ ...facts, allergies: many }, [], "x");
    const lines = m.rows.find((r) => r.key === "allergies")!.lines;
    expect(lines).toHaveLength(MAX_ROW_LINES.allergies);
    expect(lines[lines.length - 1]).toContain("and 5 more");
  });

  it("says it does not update itself and carries no health value in the file name", () => {
    expect(model({ ...DEFAULT_CHOICES, lock_screen_opt_in: true }).footer[0]).toContain("does not update itself");
    expect(LOCK_SCREEN_FILE_NAME).toBe("emergency-card-lock-screen.png");
  });

  it("leaves room at the top for the phone's clock", () => {
    expect(LOCK_SCREEN_IMAGE.topSafe).toBeGreaterThan(LOCK_SCREEN_IMAGE.height * 0.25);
    expect(LOCK_SCREEN_IMAGE.height / LOCK_SCREEN_IMAGE.width).toBeGreaterThan(2);
  });
});
