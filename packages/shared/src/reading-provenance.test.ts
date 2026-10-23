import { describe, expect, it } from "@jest/globals";
import { cleanPlaceLabel, entryOriginLabelKey, homeBpReadings, isEntryOrigin, isHomeBpReading, isLabelGuardRefusal, PLACE_LABEL_MAX, withoutPharmacyLabel } from "./reading-provenance";

describe("reading provenance", () => {
  it("knows the two labels", () => {
    expect(isEntryOrigin("pharmacy_machine")).toBe(true);
    expect(isEntryOrigin("paper_diary")).toBe(true);
    expect(isEntryOrigin("kiosk")).toBe(false);
    expect(entryOriginLabelKey("pharmacy_machine")).toBe("reading.origin.pharmacy_machine");
    expect(entryOriginLabelKey("paper_diary")).toBe("reading.origin.paper_diary");
    expect(entryOriginLabelKey(null)).toBeNull();
  });
  it("a pharmacy reading and a wearable estimate are not home readings; a diary reading and an ordinary one are", () => {
    expect(isHomeBpReading({ source: "manual", entry_origin: "pharmacy_machine" })).toBe(false);
    expect(isHomeBpReading({ source: "wearable" })).toBe(false);
    expect(isHomeBpReading({ source: "manual", entry_origin: "paper_diary" })).toBe(true);
    expect(isHomeBpReading({ source: "manual", entry_origin: null })).toBe(true);
    expect(isHomeBpReading({ source: "device" })).toBe(true);
    // a missing source or label must never hide a real reading
    expect(isHomeBpReading({})).toBe(true);
    expect(homeBpReadings([{ source: "manual", entryOrigin: "pharmacy_machine" }, { source: "device" }])).toEqual([{ source: "device" }]);
  });
  it("the place is made safe and short, and blank is null", () => {
    expect(cleanPlaceLabel("  Corner   Pharmacy\n")).toBe("Corner Pharmacy");
    expect(cleanPlaceLabel("   ")).toBeNull();
    expect(cleanPlaceLabel(null)).toBeNull();
    expect((cleanPlaceLabel("x".repeat(300)) ?? "").length).toBe(PLACE_LABEL_MAX);
  });
});

describe("withoutPharmacyLabel (only for a label whose guard turned out to be closed)", () => {
  const prefix = "Taken at a pharmacy or clinic machine.";
  it("drops the label and the place, and keeps the setting in the note so the care team can still see it", () => {
    const out = withoutPharmacyLabel({ vital_type: "blood_pressure", systolic: 148, entry_origin: "pharmacy_machine", place_label: "Corner", note: "after a walk" }, prefix);
    expect(out).toMatchObject({ vital_type: "blood_pressure", systolic: 148, note: "Taken at a pharmacy or clinic machine. (Corner) after a walk" });
    expect(out.entry_origin).toBeUndefined();
    expect(out.place_label).toBeUndefined();
  });
  it("works with no place and no note", () => {
    expect(withoutPharmacyLabel({ entry_origin: "pharmacy_machine" }, prefix).note).toBe(prefix);
  });
  it("never lets the note run past 500 characters", () => {
    expect(withoutPharmacyLabel({ entry_origin: "pharmacy_machine", note: "x".repeat(600) }, prefix).note.length).toBe(500);
  });
});

describe("isLabelGuardRefusal", () => {
  it("is the guard's own refusal only: 55000 AND the guard named in the message", () => {
    expect(isLabelGuardRefusal({ code: "55000", message: "this kind of reading is not switched on yet (pharmacy_bp_readings)" })).toBe(true);
    expect(isLabelGuardRefusal({ code: "55000", message: "this kind of reading is not switched on yet (paper_diary_entry)" })).toBe(true);
    expect(isLabelGuardRefusal({ code: "55000", message: "event bus has no active config" })).toBe(false);
    expect(isLabelGuardRefusal({ code: "22023", message: "(pharmacy_bp_readings)" })).toBe(false);
    expect(isLabelGuardRefusal(null)).toBe(false);
  });
});
