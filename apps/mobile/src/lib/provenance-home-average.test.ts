/**
 * S07y: what counts as a HOME blood pressure on the phone. A reading taken at a pharmacy or clinic machine is shown and graded but is not part of the 7-day
 * average, and neither it nor a paper-diary reading is part of the seven-day home check, matching the server (private.hbpm_average, private.home_bp_assess).
 */
import { computeSevenDayAverage, type BpReading } from "./vitals";
import { toHomeReadings } from "./home-check";
import { mergeReadings } from "./bp-history-model";

jest.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const reading = (id: string, sys: number, dia: number, over: Partial<BpReading> = {}): BpReading => ({ id, systolic: sys, diastolic: dia, takenAt: hoursAgo(2), level: "green", ...over });

describe("computeSevenDayAverage", () => {
  it("leaves a pharmacy reading out", () => {
    const avg = computeSevenDayAverage([reading("a", 120, 80), reading("b", 200, 120, { entryOrigin: "pharmacy_machine" })]);
    expect(avg).toEqual({ systolic: 120, diastolic: 80, readingCount: 1 });
  });
  it("a diary reading IS part of the general average (it is labelled, not hidden)", () => {
    const avg = computeSevenDayAverage([reading("a", 120, 80), reading("b", 140, 90, { entryOrigin: "paper_diary" })]);
    expect(avg).toEqual({ systolic: 130, diastolic: 85, readingCount: 2 });
  });
  it("only pharmacy readings: no average at all", () => {
    expect(computeSevenDayAverage([reading("a", 130, 85, { entryOrigin: "pharmacy_machine" })])).toBeNull();
  });
  it("still leaves a wearable estimate out", () => {
    expect(computeSevenDayAverage([reading("a", 120, 80), reading("b", 150, 95, { source: "wearable" })])?.readingCount).toBe(1);
  });
});

describe("toHomeReadings (the seven-day home check)", () => {
  const base = { takenAt: hoursAgo(1), systolic: 120, diastolic: 80 };
  it("counts neither a pharmacy nor a diary reading", () => {
    const out = toHomeReadings([
      { ...base },
      { ...base, entryOrigin: "pharmacy_machine" },
      { ...base, entryOrigin: "paper_diary" },
      { ...base, source: "device", entryOrigin: null },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("History", () => {
  it("carries the label of a reading on the server and of one still waiting on the phone", () => {
    const merged = mergeReadings(
      [{ id: "s1", systolic: 130, diastolic: 85, taken_at: hoursAgo(5), source: "manual", entry_origin: "pharmacy_machine" }],
      [{ clientId: "q1", state: "pending", systolic: 150, diastolic: 95, clientRecordedAt: hoursAgo(1), supportCode: "X", entryOrigin: "pharmacy_machine" }],
    );
    expect(merged.map((m) => [m.id, m.entryOrigin])).toEqual([["q1", "pharmacy_machine"], ["s1", "pharmacy_machine"]]);
  });
  it("an ordinary reading has no label", () => {
    const merged = mergeReadings([{ id: "s1", systolic: 130, diastolic: 85, taken_at: hoursAgo(5), source: "manual" }], []);
    expect(merged[0]?.entryOrigin).toBeNull();
  });
});
