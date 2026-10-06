import { describe, expect, it } from "@jest/globals";
import { circleMonthlyLines, parseCircleMonthly, parseMonthlyPayload } from "./index";

describe("Care Circle monthly rows", () => {
  const rows = parseCircleMonthly([
    { month: "2026-09-01", enough_readings: true, average: { systolic: 134, diastolic: 84, versus_target: "under" }, direction: "lower", adherence_pct: 85, adherence_shared: true },
    { month: "2026-08-01", enough_readings: false, direction: "not_enough_data" },
    { month: "2026-07-01", adherence_pct: null, adherence_shared: true },
  ]);

  it("describes a month with the readings the supporter may see", () => {
    expect(circleMonthlyLines(rows[0]!, "en")).toEqual([
      "September 2026: average 134 over 84, under their target.",
      "Lower than the month before.",
      "September 2026: medicines taken as planned, 85 percent.",
    ]);
  });
  it("says 'not enough readings' without an average, and shows nothing for a part that was not shared", () => {
    expect(circleMonthlyLines(rows[1]!, "en")).toEqual(["August 2026: not enough readings to show an average."]);
    expect(circleMonthlyLines(rows[2]!, "en")).toEqual(["July 2026: nothing to show about medicines."]);
  });
  it("a row with no shared part produces no lines (not shared is not zero)", () => {
    expect(circleMonthlyLines({ month: "2026-06-01" }, "en")).toEqual([]);
  });
  it("never carries target numbers, reading counts or the week split", () => {
    const text = rows.flatMap((r) => circleMonthlyLines(r, "pcm")).join(" ");
    expect(text).not.toMatch(/target \d|readings logged|week of/i);
    expect(Object.keys(rows[0]!)).not.toContain("weeks");
    expect(Object.keys(rows[0]!)).not.toContain("readings");
  });
  it("drops anything that is not an array of rows with a month", () => {
    expect(parseCircleMonthly("x")).toEqual([]);
    expect(parseCircleMonthly([{ nope: 1 }])).toEqual([]);
  });
});

describe("monthly payload parsing", () => {
  it("rejects a payload missing the target or with an unknown direction", () => {
    expect(parseMonthlyPayload({ month: "2026-09-01" })).toBeNull();
    expect(parseMonthlyPayload(null)).toBeNull();
  });
});
