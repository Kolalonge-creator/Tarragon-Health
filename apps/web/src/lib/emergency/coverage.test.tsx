import { renderToStaticMarkup } from "react-dom/server";
import type { EmergencyClinicalFacts } from "./card";
import { coverageInputSchema, toEmergencyCoverage } from "./coverage";
import { buildEmergencyQrText } from "./qr-text";
import { applyCardFieldChoices, MINIMAL_CHOICES } from "./field-choices";
import { EmergencyCardBody } from "@/components/emergency/emergency-card-body";

const BASE: EmergencyClinicalFacts = {
  full_name: "Ada Okafor",
  date_of_birth: "1980-02-01",
  sex: "female",
  patient_number: "TH-1",
  emergency_contact: { name: "Chi", phone: "+2348012345678", relationship: "sister" },
  allergies: [{ allergen: "Penicillin", reaction: "hives", severity: "severe" }],
  medications: [{ drug_name: "Warfarin", dose: "5 mg", frequency: "daily" }],
  conditions: [],
  blood: { blood_group: "O+", genotype: "AA", note: null, provenance: "patient_attested", recorded_at: null },
};
const COVER = { scheme: "hmo", member_number: "REL/12345", plan_name: "Reliance Gold", provenance: "patient_entered" } as const;
const html = (facts: EmergencyClinicalFacts) => renderToStaticMarkup(<EmergencyCardBody facts={facts} headerLabel="Emergency health card" headerSubline="x" footer={<p>f</p>} />);

describe("coverage input (S09y)", () => {
  it("accepts a normal HMO member number and plan", () => {
    expect(coverageInputSchema.safeParse({ scheme: "hmo", member_number: "REL/12345", plan_name: "Reliance Gold" }).success).toBe(true);
  });
  it("accepts a plan name alone, or a number alone", () => {
    expect(coverageInputSchema.safeParse({ scheme: "nhia", plan_name: "NHIA formal sector" }).success).toBe(true);
    expect(coverageInputSchema.safeParse({ scheme: "nhia", member_number: "ABC123" }).success).toBe(true);
  });
  it.each([
    ["unknown scheme", { scheme: "visa", member_number: "ABC123" }],
    ["short number", { scheme: "hmo", member_number: "12" }],
    ["number with punctuation attacks", { scheme: "hmo", member_number: "12; drop" }],
    ["markup in the plan", { scheme: "hmo", plan_name: "<b>x</b>" }],
    ["number too long", { scheme: "hmo", member_number: "A".repeat(41) }],
    ["plan too long", { scheme: "hmo", plan_name: "A".repeat(81) }],
  ])("refuses %s", (_name, input) => {
    expect(coverageInputSchema.safeParse(input).success).toBe(false);
  });
  it("trims, and both blank is valid (it means remove)", () => {
    const r = coverageInputSchema.safeParse({ scheme: "hmo", member_number: "  ", plan_name: "" });
    expect(r.success && r.data.member_number === "" && r.data.plan_name === "").toBe(true);
  });
});

describe("toEmergencyCoverage", () => {
  it("narrows a row, and is always patient entered", () => {
    expect(toEmergencyCoverage({ scheme: "nhia", member_number: "X1Y2Z3", plan_name: null, provenance: "lab_verified" })).toEqual({
      scheme: "nhia",
      member_number: "X1Y2Z3",
      plan_name: null,
      provenance: "patient_entered",
    });
  });
  it.each([[null], [undefined], ["x"], [{}], [{ scheme: "hmo" }], [{ scheme: "gold", member_number: "ABC" }], [{ scheme: "hmo", member_number: "  ", plan_name: "" }]])(
    "returns null for %j (nothing to show)",
    (v) => {
      expect(toEmergencyCoverage(v)).toBeNull();
    },
  );
});

describe("the printed card and the emergency view", () => {
  it("show cover only when the patient filled it in, and say it is unchecked", () => {
    const withCover = html({ ...BASE, coverage: COVER });
    expect(withCover).toContain("HMO cover");
    expect(withCover).toContain("REL/12345");
    expect(withCover).toContain("Reliance Gold");
    expect(withCover).toContain("Not checked with the scheme");
  });
  it("show nothing about cover when it is not filled, not even the word", () => {
    for (const facts of [BASE, { ...BASE, coverage: null }]) {
      const out = html(facts);
      expect(out).not.toContain("cover");
      expect(out).not.toContain("Member no.");
    }
  });
  it("survive the patient's own field choices (cover has no switch: filling it in is the choice)", () => {
    expect(html(applyCardFieldChoices({ ...BASE, coverage: COVER }, MINIMAL_CHOICES))).toContain("REL/12345");
  });
});

describe("the offline QR text", () => {
  it("carries one cover line, labelled patient entered, only when filled", () => {
    const text = buildEmergencyQrText({ ...BASE, coverage: COVER }, "1 Jan 2027");
    expect(text).toContain("Cover: HMO Reliance Gold, no. REL/12345 (patient entered)");
    expect(buildEmergencyQrText(BASE, "1 Jan 2027")).not.toContain("Cover:");
  });
  it("never lets cover displace an allergy or a medicine: with long lists the cover line is the one dropped", () => {
    const many = {
      ...BASE,
      coverage: { ...COVER, plan_name: "P".repeat(60), member_number: "M".repeat(40) },
      allergies: Array.from({ length: 30 }, (_, i) => ({ allergen: `Allergen number ${i} with a long name`, reaction: null, severity: "mild" })),
      medications: Array.from({ length: 30 }, (_, i) => ({ drug_name: `Medicine number ${i} with a long name`, dose: "10 mg", frequency: null })),
    };
    const withCover = buildEmergencyQrText(many, "1 Jan 2027");
    const without = buildEmergencyQrText({ ...many, coverage: null }, "1 Jan 2027");
    expect(withCover).not.toContain("Cover:");
    // the allergy and medicine lines are exactly what they would be with no cover at all
    expect(withCover).toBe(without);
    expect(withCover).toContain("Allergen number 0");
    expect(withCover).toContain("Medicine number 0");
  });
});
