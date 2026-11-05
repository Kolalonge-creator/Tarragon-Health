import {
  CONFIRM_OUTCOME_MESSAGE,
  UNDO_OUTCOME_MESSAGE,
  canUndoConfirmation,
  countsAsSupply,
  describeForCareTeam,
  describeForPatient,
  describePatientReportForPharmacist,
  isConfirmOutcome,
  isUndoOutcome,
  type SupplyRecordLike,
} from "./patient-supply";
import { describeSupply } from "./public-verification";

const NOW = new Date("2026-11-05T12:00:00Z");

function confirmation(overrides: Partial<SupplyRecordLike> = {}): SupplyRecordLike {
  return {
    source: "patient",
    recorded_via: "patient_confirmation",
    dispensed_on: "2026-11-05",
    created_at: "2026-11-05T10:00:00Z",
    pharmacy_name: "Corner Chemist",
    pharmacy_town: "Ikeja",
    withdrawn_at: null,
    matched_dispense_id: null,
    ...overrides,
  };
}

describe("T2-11c patient-reported supply", () => {
  it("labels the patient's confirmation for the care team", () => {
    expect(describeForCareTeam(confirmation())).toBe("Patient says they collected it on 5 Nov 2026 at Corner Chemist, Ikeja");
    expect(describeForCareTeam(confirmation({ pharmacy_name: null, pharmacy_town: null }))).toBe("Patient says they collected it on 5 Nov 2026");
    expect(describeForCareTeam(confirmation({ withdrawn_at: "2026-11-05T11:00:00Z" }))).toMatch(/taken back by the patient/);
  });

  it("keeps the pharmacy wording for a pharmacy record", () => {
    expect(describeForCareTeam({ ...confirmation(), source: "pharmacy", recorded_via: "public_verification" })).toBe("5 Nov 2026 · Corner Chemist");
  });

  it("tells the patient in their own words", () => {
    expect(describeForPatient(confirmation())).toBe("You told us you collected this on 5 Nov 2026 at Corner Chemist, Ikeja.");
    expect(describeForPatient(confirmation({ matched_dispense_id: "p1" }))).toMatch(/pharmacy has since recorded it/);
  });

  it("counts the same rows the database counts", () => {
    expect(countsAsSupply(confirmation())).toBe(true);
    expect(countsAsSupply(confirmation({ withdrawn_at: "x" }))).toBe(false);
    expect(countsAsSupply(confirmation({ matched_dispense_id: "p1" }))).toBe(false);
    expect(countsAsSupply(confirmation({ recorded_via: "app" }))).toBe(false);
    expect(countsAsSupply({ ...confirmation(), source: "pharmacy", recorded_via: "public_verification", disputed_at: null })).toBe(true);
    expect(countsAsSupply({ ...confirmation(), source: "pharmacy", recorded_via: "public_verification", disputed_at: "x" })).toBe(false);
  });

  it("offers undo only within 24 hours and only while unmatched", () => {
    expect(canUndoConfirmation(confirmation(), NOW)).toBe(true);
    expect(canUndoConfirmation(confirmation({ created_at: "2026-11-04T11:59:00Z" }), NOW)).toBe(false);
    expect(canUndoConfirmation(confirmation({ matched_dispense_id: "p1" }), NOW)).toBe(false);
    expect(canUndoConfirmation(confirmation({ withdrawn_at: "2026-11-05T11:00:00Z" }), NOW)).toBe(false);
    expect(canUndoConfirmation(confirmation({ recorded_via: "app" }), NOW)).toBe(false);
  });

  it("tells a pharmacist it was collected, as reported by the patient, with no identity", () => {
    const text = describePatientReportForPharmacist({ self_reported_supplies: 1, last_self_report_on: "2026-11-05", self_report_awaiting_pharmacy: true });
    expect(text).toMatch(/^Collected, as reported by the patient on 5 Nov 2026\./);
    expect(text).toMatch(/record it below to confirm/);
    expect(describePatientReportForPharmacist({ self_reported_supplies: 0 })).toBeNull();
    expect(describePatientReportForPharmacist({})).toBeNull();
  });

  it("explains why the record form is still shown when no supply is available", () => {
    const base = { supplies_dispensed: 1, supplies_permitted: 1, supply_available: false, repeats_allowed: 0, repeats_remaining: 0 };
    expect(describeSupply({ ...base, self_report_awaiting_pharmacy: true })).toMatch(/only if your pharmacy is the one that supplied/);
    expect(describeSupply(base)).toMatch(/Do not dispense again/);
  });

  it("has a message for every outcome, and no em dashes in any copy", () => {
    for (const k of ["recorded", "matched_pharmacy_record", "already_recorded", "duplicate", "no_supply_available", "not_active", "invalid", "not_found"]) {
      expect(isConfirmOutcome(k)).toBe(true);
    }
    for (const k of ["undone", "window_passed", "confirmed_by_pharmacy", "not_found"]) expect(isUndoOutcome(k)).toBe(true);
    expect(isConfirmOutcome("toString")).toBe(false);
    const all = [...Object.values(CONFIRM_OUTCOME_MESSAGE).map((m) => m.text), ...Object.values(UNDO_OUTCOME_MESSAGE)];
    for (const text of all) expect(text).not.toMatch(/—/);
  });
});
