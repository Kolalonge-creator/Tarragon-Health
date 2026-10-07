import { canRecordFromDesk, deskVerdict, describeNameCheck, parseDeskResult } from "./desk";

const found = {
  found: true, status: "active" as const, rx_number: "TRG-RX-2026-000366", drug_name: "Amlodipine", dose: "5 mg", frequency: "daily", quantity: "30 tablets",
  duration_days: 30, repeats_allowed: 1, supplies_dispensed: 0, supplies_permitted: 1, supply_available: true, last_supplied_on: null,
  signed_at: "2026-10-01T09:00:00Z", expires_at: "2027-04-01T00:00:00Z", version: 1, prescriber_name: "Ada Longe", prescriber_credential: "MDCN R2311",
  name_checked: false, name_matches: false,
};

describe("parseDeskResult", () => {
  it("reads a found row, a not-found row, and treats anything malformed as an error", () => {
    expect(parseDeskResult([found])).toMatchObject({ kind: "found" });
    expect(parseDeskResult([{ found: false }])).toEqual({ kind: "not_found" });
    expect(parseDeskResult(null).kind).toBe("error");
    expect(parseDeskResult([]).kind).toBe("error");
    expect(parseDeskResult([{ ...found, status: "valid" }]).kind).toBe("error");
    expect(parseDeskResult([{ ...found, found: "yes" }]).kind).toBe("error");
  });
});

describe("describeNameCheck", () => {
  it("only a checked and matching name is good; a mismatch tells the pharmacist not to dispense", () => {
    expect(describeNameCheck({ name_checked: false, name_matches: false }).tone).toBe("neutral");
    expect(describeNameCheck({ name_checked: true, name_matches: true }).tone).toBe("good");
    const bad = describeNameCheck({ name_checked: true, name_matches: false });
    expect(bad.tone).toBe("bad");
    expect(bad.text).toMatch(/not to dispense/i);
  });
});

describe("deskVerdict / canRecordFromDesk", () => {
  it("never says dispense unless the prescription is active, the name (if checked) matches and a supply is available", () => {
    for (const status of ["superseded", "expired", "cancelled"] as const) {
      expect(deskVerdict({ ...found, status })).toMatch(/^Do not dispense/);
      expect(canRecordFromDesk({ status, supply_available: true })).toBe(false);
    }
    expect(deskVerdict({ ...found, name_checked: true, name_matches: false })).toMatch(/^Do not dispense: the name/);
    expect(deskVerdict({ ...found, supply_available: false })).toMatch(/^Do not dispense: every available supply/);
    expect(deskVerdict({ ...found, name_checked: true, name_matches: true })).toMatch(/name matches and a supply is available/);
    expect(deskVerdict(found)).toMatch(/has not been checked yet/);
    expect(canRecordFromDesk({ status: "active", supply_available: true })).toBe(true);
    expect(canRecordFromDesk({ status: "active", supply_available: false })).toBe(false);
  });
});
