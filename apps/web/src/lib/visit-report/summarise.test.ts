import { parsePeriodDays, summariseReadings, type VisitReportReading } from "./summarise";

const base: VisitReportReading = {
  vital_type: "blood_pressure",
  taken_at: "2026-10-01T08:00:00Z",
  systolic: null,
  diastolic: null,
  pulse_bpm: null,
  glucose_mmol_l: null,
  glucose_context: null,
  weight_kg: null,
  validation_status: "valid",
  source: "manual",
};
const r = (o: Partial<VisitReportReading>): VisitReportReading => ({ ...base, ...o });

describe("summariseReadings", () => {
  it("returns empty sections for no readings", () => {
    const s = summariseReadings([], 30);
    expect(s.bp).toBeNull();
    expect(s.pulse).toBeNull();
    expect(s.weight).toBeNull();
    expect(s.glucoseByContext).toEqual([]);
    expect(s.totalConsidered).toBe(0);
  });

  it("averages BP and picks the latest by time, not input order", () => {
    const s = summariseReadings(
      [
        r({ systolic: 150, diastolic: 95, taken_at: "2026-10-03T08:00:00Z" }),
        r({ systolic: 130, diastolic: 85, taken_at: "2026-10-01T08:00:00Z" }),
      ],
      30,
    );
    expect(s.bp).toMatchObject({
      count: 2,
      averageSystolic: 140,
      averageDiastolic: 90,
      minSystolic: 130,
      maxSystolic: 150,
    });
    expect(s.bp?.latest.systolic).toBe(150);
  });

  it("excludes unvalidated readings but reports how many", () => {
    const s = summariseReadings(
      [
        r({ systolic: 120, diastolic: 80 }),
        r({ systolic: 260, diastolic: 20, validation_status: "requires_validation" }),
      ],
      30,
    );
    expect(s.bp?.count).toBe(1);
    expect(s.bp?.maxSystolic).toBe(120);
    expect(s.excludedUnvalidated).toBe(1);
  });

  it("groups glucose by context in a fixed order, null context as random", () => {
    const s = summariseReadings(
      [
        r({ vital_type: "glucose", glucose_mmol_l: 8, glucose_context: "post_meal" }),
        r({ vital_type: "glucose", glucose_mmol_l: 5, glucose_context: "fasting" }),
        r({ vital_type: "glucose", glucose_mmol_l: 6, glucose_context: "fasting" }),
        r({ vital_type: "glucose", glucose_mmol_l: 7, glucose_context: null }),
      ],
      30,
    );
    expect(s.glucoseByContext.map((g) => g.context)).toEqual(["fasting", "post_meal", "random"]);
    expect(s.glucoseByContext[0]).toMatchObject({ count: 2, average: 5.5, min: 5, max: 6 });
  });

  it("computes weight change from first to latest", () => {
    const s = summariseReadings(
      [
        r({ vital_type: "weight", weight_kg: 80, taken_at: "2026-09-10T08:00:00Z" }),
        r({ vital_type: "weight", weight_kg: 78.4, taken_at: "2026-10-01T08:00:00Z" }),
      ],
      90,
    );
    expect(s.weight?.changeKg).toBe(-1.6);
  });

  it("counts sources so wearable estimates stay visible", () => {
    const s = summariseReadings(
      [
        r({ systolic: 120, diastolic: 80, source: "wearable" }),
        r({ systolic: 122, diastolic: 82, source: "device" }),
        r({ systolic: 124, diastolic: 84, source: "manual" }),
      ],
      7,
    );
    expect(s.sourceCounts).toEqual({ manual: 1, device: 1, wearable: 1 });
  });
});

describe("parsePeriodDays", () => {
  it("accepts allowed periods and defaults otherwise", () => {
    expect(parsePeriodDays("7")).toBe(7);
    expect(parsePeriodDays("90")).toBe(90);
    expect(parsePeriodDays("365")).toBe(30);
    expect(parsePeriodDays(null)).toBe(30);
    expect(parsePeriodDays("abc")).toBe(30);
  });
});
