/** The Vitals latest-readings row on the phone: the reader's own units, when and trend in words, and a failed read said plainly. */
import { DEFAULT_MEASUREMENT_UNITS } from "@tarragon/shared";
import { latestReadingContent } from "./latest-readings";

const NOW = Date.parse("2026-11-06T17:00:00Z");
const DAY = 86_400_000;

it("shows the latest value in the reader's units with when and the trend word", () => {
  const series = { latestAt: NOW - DAY, latestValue: 5.5, points: [{ t: NOW - 20 * DAY, v: 5.4 }, { t: NOW - DAY, v: 5.5 }] };
  const mmol = latestReadingContent("glucose", series, "mmol_l", DEFAULT_MEASUREMENT_UNITS, NOW);
  expect(mmol).toMatchObject({ label: "Blood sugar", value: "5.5", detail: "Yesterday" });
  expect(mmol.points).toHaveLength(2);
  const mgdl = latestReadingContent("glucose", series, "mg_dl", DEFAULT_MEASUREMENT_UNITS, NOW);
  expect(mgdl.value).toBe("99");
  expect(latestReadingContent("pulse", { latestAt: NOW - DAY, latestValue: 71.6, points: [] }, "mmol_l", DEFAULT_MEASUREMENT_UNITS, NOW)).toMatchObject({ value: "72", unit: "bpm" });
});

it("says a failed read could not load, never that there is no reading", () => {
  expect(latestReadingContent("weight", "failed", "mmol_l", DEFAULT_MEASUREMENT_UNITS, NOW)).toEqual({ label: "Weight", empty: "Couldn't load just now" });
  expect(latestReadingContent("weight", { latestAt: null, latestValue: null, points: [] }, "mmol_l", DEFAULT_MEASUREMENT_UNITS, NOW).empty).toBe("No reading yet");
  expect(latestReadingContent("weight", undefined, "mmol_l", DEFAULT_MEASUREMENT_UNITS, NOW).empty).toBe("Loading");
});
