import { describe, expect, it } from "@jest/globals";
import { careGapCopy, careGapText, type CareGapCopyKey } from "./care-gap-copy";

const entries = Object.entries(careGapCopy) as [CareGapCopyKey, string][];
const patientEntries = entries.filter(([k]) => k.startsWith("patient."));

/** A copy of the INV-07 stems the sender enforces (supabase/functions/_shared/notifications/neutral.ts); the notifications package pins the real list. */
const NEUTRAL_STEMS = [
  "diabet", "hypertens", "blood pressure", "bp", "sugar", "glucose", "cholesterol", "lipid", "hba1c", "reading", "result", "lab", "medicine", "medication", "pill",
  "dose", "refill", "pressure", "screening", "symptom", "treatment", "trend", "gap", "missed", "overdue", "test", "heart", "kidney", "cancer", "pregnan",
];

describe("care gap copy", () => {
  it("has no em dash and no en dash", () => {
    for (const [k, v] of entries) expect(`${k}: ${v}`).not.toMatch(/[–—]/);
  });

  it("never says 'your doctor' and never says doctor-led", () => {
    for (const [, v] of entries) {
      expect(v.toLowerCase()).not.toContain("your doctor");
      expect(v.toLowerCase()).not.toContain("doctor-led");
    }
  });

  it("the patient wording names no condition, reading, result, medicine, test or number (INV-07)", () => {
    expect(patientEntries.length).toBeGreaterThanOrEqual(8);
    for (const [k, v] of patientEntries) {
      const lower = v.toLowerCase();
      for (const stem of NEUTRAL_STEMS) {
        const re = new RegExp(`(^|[^a-z])${stem}`);
        expect({ key: k, stem, hit: re.test(lower) }).toEqual({ key: k, stem, hit: false });
      }
      expect(v).not.toMatch(/\d/);
    }
  });

  it("the staff wording is where the condition is named, and says it is for staff only", () => {
    expect(careGapCopy["staff.why.staff_only"]).toMatch(/never shown in a message to the patient/);
    expect(careGapCopy["staff.why.reading_bp"]).toMatch(/blood pressure/);
    expect(entries.filter(([k]) => k.startsWith("staff.")).length).toBeGreaterThan(30);
  });

  it("says plainly that a message sent or opened never closes a gap", () => {
    expect(careGapCopy["staff.section.intro"]).toMatch(/message sent or opened never closes it/);
  });

  it("the institution wording is counts of people only and explains the withholding", () => {
    expect(careGapCopy["institution.intro"]).toMatch(/Counts of people only/);
    expect(careGapCopy["institution.withheld_note"]).toMatch(/subtraction/);
  });

  it("fills its placeholders", () => {
    expect(careGapText("staff.why.reading_bp", { days: 21, line: 14 })).toBe("No blood pressure reading in 21 days (the line is 14).");
    expect(careGapText("institution.withheld_note", { min: 10 })).not.toMatch(/[{}]/);
  });
});
