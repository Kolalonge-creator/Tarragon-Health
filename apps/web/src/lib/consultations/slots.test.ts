import { describe, expect, it } from "@jest/globals";
import { filterConsultSlots, NO_SLOT_FILTERS, slotFilterOptions, toConsultSlots, type BookableConsultSlotRow } from "./slots";

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
      { clinician_id: "11111111-1111-4111-8111-111111111111", clinician_name: "Dr Ada", slot_start: "2026-10-12T09:00:00Z", slot_end: "2026-10-12T09:30:00Z", consultation_method: "telemedicine", location: null,
        specialty: "General practice", languages: ["en"], sex: null, mdcn_number: null, licence_checked_on: null },
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

describe("S64 licence display (Q19), null-gated", () => {
  it("shows the number only together with the date it was checked", () => {
    const [s] = toConsultSlots([row({ mdcn_number: "MDCN/12345", licence_checked_on: "2026-09-20T10:00:00Z" })]);
    expect([s?.mdcn_number, s?.licence_checked_on]).toEqual(["MDCN/12345", "2026-09-20T10:00:00Z"]);
  });
  it("shows neither when no check is on record, or when the date is unusable", () => {
    for (const over of [{ mdcn_number: "MDCN/12345", licence_checked_on: null }, { mdcn_number: null, licence_checked_on: "2026-09-20T10:00:00Z" }, { mdcn_number: "MDCN/1", licence_checked_on: "nope" }]) {
      const [s] = toConsultSlots([row(over)]);
      expect([s?.mdcn_number, s?.licence_checked_on]).toEqual([null, null]);
    }
  });
});

describe("S64 booking filters (15.1)", () => {
  const slots = toConsultSlots([
    row({ clinician_id: "a", specialty: "General practice", languages: ["en", "yo"], sex: "female" }),
    row({ clinician_id: "b", specialty: "Cardiology", languages: ["en"], sex: "male" }),
    row({ clinician_id: "c", specialty: null, languages: ["ig"], sex: null }),
  ]);
  const ids = (x: typeof slots) => x.map((s) => s.clinician_id);
  it("no filter keeps everything", () => expect(ids(filterConsultSlots(slots, NO_SLOT_FILTERS))).toEqual(["a", "b", "c"]));
  it("filters by specialty, spoken language and sex, case-insensitively, and combines them", () => {
    expect(ids(filterConsultSlots(slots, { ...NO_SLOT_FILTERS, specialty: "cardiology" }))).toEqual(["b"]);
    expect(ids(filterConsultSlots(slots, { ...NO_SLOT_FILTERS, language: "YO" }))).toEqual(["a"]);
    expect(ids(filterConsultSlots(slots, { ...NO_SLOT_FILTERS, sex: "Female" }))).toEqual(["a"]);
    expect(ids(filterConsultSlots(slots, { specialty: "General practice", language: "en", sex: "male" }))).toEqual([]);
  });
  it("offers only choices that exist in the open slots", () => {
    expect(slotFilterOptions(slots)).toEqual({ specialties: ["Cardiology", "General practice"], languages: ["en", "ig", "yo"], sexes: ["female", "male"] });
  });
});
