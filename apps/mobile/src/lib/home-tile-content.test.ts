/** Home's big-number tiles on the phone: value, when and trend in words, and a failed read never shown as "no reading yet". */
import { homeTileContent, type TileInputs } from "./home-tile-content";

jest.mock("./medications", () => ({}));
jest.mock("./reading-series", () => ({}));

const NOW = Date.parse("2026-11-06T17:00:00Z");
const DAY = 86_400_000;
const stats = { latestBp: { systolic: 128, diastolic: 82 }, latestGlucoseMmolL: 5.6, activeMedicationCount: 2, dosesTaken: 1, dosesTotal: 2, lastVitalTakenAt: null, hasRiskAssessment: false };
const base: TileInputs = { stats, glucoseUnit: "mmol_l", vitalValues: {}, vitalsFailed: false, trends: null };
const pts = (pairs: [number, number][]) => pairs.map(([d, v]) => ({ t: NOW - d * DAY, v }));

it("shows blood pressure large, with when and the trend word", () => {
  const points = pts([[15, 120], [10, 121], [2, 130], [1, 131]]);
  const c = homeTileContent("bp", { ...base, trends: { nowMs: NOW, series: { bp: { latestAt: NOW - DAY, latestValue: 131, points } }, doses: null } });
  expect(c).toMatchObject({ label: "Blood pressure", value: "128/82", unit: "mmHg", detail: "Yesterday · Higher than earlier this month" });
  expect(c.points).toHaveLength(4);
});

it("says the trend could not load rather than drawing nothing", () => {
  const c = homeTileContent("bp", { ...base, trends: { nowMs: NOW, series: { bp: "failed" }, doses: null } });
  expect(c.detail).toBe("Couldn't load the last 30 days");
  expect(c.points).toBeUndefined();
});

it("never shows a failed vitals read as no reading yet", () => {
  expect(homeTileContent("weight", { ...base, vitalsFailed: true }).empty).toBe("Couldn't load, tap to open");
  expect(homeTileContent("weight", base).empty).toBe("No reading yet");
  expect(homeTileContent("weight", { ...base, vitalValues: { weight: { value: "74.0", unit: "kg" } } })).toMatchObject({ value: "74.0", unit: "kg" });
});

it("leads the doses tile with the last 7 completed days, and falls back to today when the week fails", () => {
  const days = Array.from({ length: 28 }, (_, i) => ({ date: `d${i}`, due: 2, taken: 2 }));
  const ok = homeTileContent("doses_today", {
    ...base,
    trends: { nowMs: NOW, series: {}, doses: { ok: true, data: { last7: { due: 14, taken: 12, percent: 86 }, last30: { due: 60, taken: 50, percent: 83 }, days } } },
  });
  expect(ok).toMatchObject({ label: "Doses, last 7 days", value: "86%", unit: "12 of 14", detail: "Today: 1 of 2 so far" });
  expect(ok.doseDays).toHaveLength(7);
  const failed = homeTileContent("doses_today", { ...base, trends: { nowMs: NOW, series: {}, doses: { ok: false, error: "x" } } });
  expect(failed).toMatchObject({ label: "Doses today", value: "1 of 2", detail: "The last 7 days couldn't load just now" });
});

it("says nothing is on the list rather than a bare zero", () => {
  expect(homeTileContent("active_meds", { ...base, stats: { ...stats, activeMedicationCount: 0 } }).empty).toBe("None on your list yet");
  expect(homeTileContent("bp", { ...base, stats: { ...stats, latestBp: null } }).empty).toBe("No reading yet");
});
