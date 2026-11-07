/** The phone's doses-taken bars: due sets the bar, taken fills it, a day with nothing due is a short tick, and the words say it all. */
import { doseBars, doseChartSummary } from "./dose-bars";

it("scales bars to the busiest day and fills the taken share", () => {
  const bars = doseBars(
    [
      { date: "2026-11-01", due: 2, taken: 1 },
      { date: "2026-11-02", due: 1, taken: 1 },
      { date: "2026-11-03", due: 0, taken: 0 },
    ],
    100,
  );
  expect(bars[0]).toEqual({ date: "2026-11-01", total: 100, taken: 50, empty: false });
  expect(bars[1]).toEqual({ date: "2026-11-02", total: 50, taken: 50, empty: false });
  expect(bars[2]).toEqual({ date: "2026-11-03", total: 3, taken: 0, empty: true });
});

it("never draws taken past the bar, and keeps a small bar visible", () => {
  const [a, b] = doseBars([{ date: "a", due: 10, taken: 12 }, { date: "b", due: 1, taken: 0 }], 30);
  expect(a!.taken).toBe(a!.total);
  expect(b!.total).toBe(6);
});

it("puts the window in words", () => {
  expect(doseChartSummary({ due: 14, taken: 12 }, 7)).toBe("In the last 7 days you marked 12 of 14 doses taken.");
  expect(doseChartSummary({ due: 0, taken: 0 }, 28)).toBe("Nothing was due in the last 28 days.");
});
