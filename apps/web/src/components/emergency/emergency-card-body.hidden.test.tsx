import { renderToStaticMarkup } from "react-dom/server";
import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { applyCardFieldChoices, DEFAULT_CHOICES, MINIMAL_CHOICES, hiddenFields, knownHiddenFields } from "@/lib/emergency/field-choices";
import { buildEmergencyQrText } from "@/lib/emergency/qr-text";
import { EmergencyCardBody } from "./emergency-card-body";

const FACTS: EmergencyClinicalFacts = {
  full_name: "Ada Okafor",
  date_of_birth: "1980-02-01",
  sex: "female",
  patient_number: "TH-1",
  emergency_contact: { name: "Chi", phone: "+2348012345678", relationship: "sister" },
  allergies: [{ allergen: "Penicillin", reaction: "hives", severity: "severe" }],
  medications: [{ drug_name: "Warfarin", dose: "5 mg", frequency: "daily" }],
  conditions: ["diabetes"],
  blood: { blood_group: "O+", genotype: "AA", note: null, provenance: "lab_document", recorded_at: null },
};

function render(hidden: readonly string[], facts = FACTS) {
  return renderToStaticMarkup(<EmergencyCardBody facts={facts} headerLabel="Emergency health card" headerSubline="x" footer={<p>f</p>} hidden={hidden} />);
}

describe("a detail the patient chose not to share (S43)", () => {
  it("is shown as not shared, never as None recorded, on the card", () => {
    const chosen = applyCardFieldChoices(FACTS, MINIMAL_CHOICES);
    const html = render(hiddenFields(MINIMAL_CHOICES), chosen);
    // medicines and conditions were hidden: the card must not look like the patient has none
    expect((html.match(/Not shared by the patient/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("None recorded.");
    expect(html).not.toContain("Warfarin");
    expect(html).toContain("Date of birth not shared");
  });

  it("still says None recorded for a detail the patient has not got on file and did not hide", () => {
    const html = render([], { ...FACTS, medications: [] });
    expect(html).toContain("None recorded.");
    expect(html).not.toContain("Not shared by the patient");
  });

  it("the QR text says NOT SHARED for each hidden detail and never writes none recorded for it", () => {
    const chosen = applyCardFieldChoices(FACTS, MINIMAL_CHOICES);
    const text = buildEmergencyQrText(chosen, "7 Oct 2026", hiddenFields(MINIMAL_CHOICES));
    expect(text).toContain("Medicines: NOT SHARED by the patient, ask");
    expect(text).toContain("Conditions: NOT SHARED by the patient, ask");
    expect(text).toContain("DOB: not shared");
    expect(text).not.toMatch(/Medicines: none recorded/i);
    // what was chosen is still there
    expect(text).toContain("Penicillin");
    expect(text).toContain("O+");
    expect(text).toContain("Chi");
  });

  it("the QR text is unchanged when nothing is hidden", () => {
    expect(buildEmergencyQrText(FACTS, "7 Oct 2026")).toBe(buildEmergencyQrText(FACTS, "7 Oct 2026", []));
    expect(buildEmergencyQrText(FACTS, "7 Oct 2026")).toContain("Warfarin");
  });

  it("a hidden blood group and contact are marked not shared in the QR text", () => {
    const text = buildEmergencyQrText(applyCardFieldChoices(FACTS, { ...MINIMAL_CHOICES, blood: false, emergency_contact: false }), "7 Oct 2026", ["blood", "emergency_contact"]);
    expect(text).toContain("Blood: NOT SHARED");
    expect(text).toContain("Contact: NOT SHARED");
  });
});

describe("knownHiddenFields", () => {
  it("keeps only known field names, from whatever the payload held", () => {
    expect(knownHiddenFields(["blood", "nonsense", 3, "allergies"])).toEqual(["blood", "allergies"]);
    expect(knownHiddenFields(undefined)).toEqual([]);
    expect(knownHiddenFields("blood")).toEqual([]);
  });
});

describe("a withheld sensitive medicine is counted, and an ambiguous medicine is never withheld (S47d)", () => {
  const MEDS = [
    { drug_name: "Metformin", dose: "500 mg", frequency: null },
    { drug_name: "Combined contraceptive pill", dose: null, frequency: null },
    { drug_name: "Sertraline", dose: "50 mg", frequency: null },
    // drugs with common other uses: they must stay on the card
    { drug_name: "Diazepam", dose: "5 mg", frequency: null },
    { drug_name: "Lithium", dose: null, frequency: null },
    { drug_name: "Misoprostol", dose: null, frequency: null },
    { drug_name: "Amitriptyline", dose: null, frequency: null },
  ];
  const facts = { ...FACTS, medications: MEDS };
  const choices = DEFAULT_CHOICES;

  it("keeps the ambiguous medicines and counts the two it withheld", () => {
    const out = applyCardFieldChoices(facts, choices);
    expect(out.medications.map((m) => m.drug_name)).toEqual(["Metformin", "Diazepam", "Lithium", "Misoprostol", "Amitriptyline"]);
    expect(out.medicines_not_shown).toBe(2);
  });

  it("says so on the card without naming them", () => {
    const html = render([], applyCardFieldChoices(facts, choices));
    expect(html).toContain("2 medicines are not shown by the patient");
    expect(html).not.toContain("Sertraline");
    expect(html).not.toContain("contraceptive");
  });

  it("a card whose only medicines were withheld never reads None recorded", () => {
    const only = applyCardFieldChoices({ ...FACTS, medications: [MEDS[1]] }, choices);
    const html = render([], only);
    expect(html).toContain("1 medicine is not shown by the patient");
    const medicinesSection = html.slice(html.indexOf("Current medicines"), html.indexOf("Ongoing conditions"));
    expect(medicinesSection).not.toContain("None recorded");
  });

  it("the offline QR text carries the same marker", () => {
    const text = buildEmergencyQrText(applyCardFieldChoices(facts, choices), "1 Jan 2027", []);
    expect(text).toContain("2 more not shown by the patient, ask");
    expect(text).not.toContain("Sertraline");
  });

  it("with both switches on nothing is withheld and no marker appears", () => {
    const out = applyCardFieldChoices(facts, { ...choices, reproductive: true, mental_health: true });
    expect(out.medicines_not_shown).toBeUndefined();
    expect(render([], out)).not.toContain("not shown by the patient");
  });
});
