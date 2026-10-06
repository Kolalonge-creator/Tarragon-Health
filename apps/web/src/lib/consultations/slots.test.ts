import { describe, expect, it } from "@jest/globals";
import { toConsultSlots, type BookableConsultSlotRow } from "./slots";

const row = (over: Partial<BookableConsultSlotRow> = {}): BookableConsultSlotRow => ({
  clinician_id: "11111111-1111-4111-8111-111111111111",
  clinician_name: "Dr Ada",
  specialty: "General practice",
  languages: ["en"],
  licence_current: true,
  licence_verified_at: "2026-10-01T09:00:00Z",
  slot_start: "2026-10-12T09:00:00Z",
  slot_end: "2026-10-12T09:30:00Z",
  ...over,
});

describe("toConsultSlots", () => {
  it("maps a row onto the slot shape the booking list renders", () => {
    expect(toConsultSlots([row()])).toEqual([
      { clinician_id: "11111111-1111-4111-8111-111111111111", clinician_name: "Dr Ada", slot_start: "2026-10-12T09:00:00Z", slot_end: "2026-10-12T09:30:00Z", consultation_method: "telemedicine", location: null },
    ]);
  });

  it("gives a missing or blank name a neutral label rather than a blank", () => {
    expect(toConsultSlots([row({ clinician_name: null }), row({ clinician_name: "   " })]).map((s) => s.clinician_name)).toEqual(["Care team", "Care team"]);
  });

  it("drops a slot whose clinician licence is not current (a second lock behind the database)", () => {
    expect(toConsultSlots([row({ licence_current: false })])).toEqual([]);
  });

  it("drops malformed rows instead of showing a slot that cannot be held", () => {
    expect(toConsultSlots([row({ slot_start: "not a date" }), row({ slot_end: "2026-10-12T08:00:00Z" }), row({ slot_end: "" })])).toEqual([]);
  });

  it("answers an empty list for nothing", () => {
    expect(toConsultSlots(null)).toEqual([]);
    expect(toConsultSlots(undefined)).toEqual([]);
    expect(toConsultSlots([])).toEqual([]);
  });
});
