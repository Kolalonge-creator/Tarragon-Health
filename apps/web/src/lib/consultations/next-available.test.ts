import { daysAwayLabel, nextAvailable } from "./next-available";
import type { ConsultSlot } from "./slots";

const slot = (start: string): ConsultSlot => ({
  clinician_id: "c", clinician_name: "Dr A", slot_start: start, slot_end: start, consultation_method: "telemedicine",
  location: null, specialty: null, languages: [], sex: null, licence_checked_on: null,
});
const NOW = Date.parse("2026-10-30T09:00:00Z");

describe("nextAvailable", () => {
  it("picks the earliest future slot whatever order the list is in", () => {
    const r = nextAvailable([slot("2026-11-05T10:00:00Z"), slot("2026-11-02T10:00:00Z"), slot("2026-11-09T10:00:00Z")], NOW);
    expect(r?.slot.slot_start).toBe("2026-11-02T10:00:00Z");
    expect(r?.daysAway).toBe(3);
  });
  it("ignores past slots and gives null for none (never a guess)", () => {
    expect(nextAvailable([slot("2026-10-29T10:00:00Z")], NOW)).toBeNull();
    expect(nextAvailable([], NOW)).toBeNull();
    expect(nextAvailable([slot("not a date")], NOW)).toBeNull();
  });
  it("counts days on the Lagos calendar: late evening UTC is already tomorrow in Lagos", () => {
    expect(nextAvailable([slot("2026-10-30T23:30:00Z")], NOW)?.daysAway).toBe(1);
    expect(nextAvailable([slot("2026-10-30T12:00:00Z")], NOW)?.daysAway).toBe(0);
  });
  it("labels", () => {
    expect([0, 1, 4].map(daysAwayLabel)).toEqual(["Today", "Tomorrow", "In 4 days"]);
  });
});
