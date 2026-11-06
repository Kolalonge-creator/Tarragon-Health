/**
 * Doses-taken charts (2026-11-06): completed Lagos days only (today's open dose never counts as missed), the shared
 * adherence formula for every figure, and one entry per day.
 */
import { groupLogsBySlot, specFromLegacyTimes, type AdherenceMedicine } from "@tarragon/medicines";
import { buildDoseHistory } from "./dose-history";

const cfg = { windowDays: 7, minDoses: 3, missedAfterMinutes: 120, thresholdPercent: 80 };
// 2026-11-06 12:00 Lagos.
const NOW = Date.parse("2026-11-06T11:00:00Z");

function med(takenDates: string[]): AdherenceMedicine {
  const logs = takenDates.map((date) => ({ status: "taken" as const, source: null, loggedAtMs: Date.parse(`${date}T07:10:00Z`), date, time: "08:00" }));
  return { id: "m1", spec: specFromLegacyTimes(["08:00"]), logs: groupLogsBySlot(logs), activeFromMs: Date.parse("2026-09-01T00:00:00Z") };
}

it("counts completed days only, ending yesterday", () => {
  const h = buildDoseHistory([med([])], NOW, cfg);
  expect(h.days).toHaveLength(28);
  expect(h.days.at(-1)!.date).toBe("2026-11-05");
  expect(h.last7).toEqual({ due: 7, taken: 0, percent: 0 });
});

it("reports each day and the 7- and 30-day figures from the marked doses", () => {
  const h = buildDoseHistory([med(["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-01", "2026-11-02", "2026-10-31"])], NOW, cfg);
  expect(h.days.at(-1)).toEqual({ date: "2026-11-05", due: 1, taken: 1 });
  expect(h.days.at(-7)).toEqual({ date: "2026-10-30", due: 1, taken: 0 });
  expect(h.last7).toEqual({ due: 7, taken: 6, percent: 86 });
  expect(h.last30.due).toBe(30);
  expect(h.last30.taken).toBe(6);
});

it("says nothing was due before a medicine was added", () => {
  const m = { ...med([]), activeFromMs: Date.parse("2026-11-04T00:00:00Z") };
  const h = buildDoseHistory([m], NOW, cfg);
  expect(h.days.at(-3)).toEqual({ date: "2026-11-03", due: 0, taken: 0 });
  expect(h.last7.percent).toBeNull(); // 2 due, below the minimum of 3
});
