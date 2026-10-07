import { buildWeeklySummary, type WeeklyReading } from "./weekly";

const NOW = new Date("2026-10-07T12:00:00Z");
const base: WeeklyReading = {
  vital_type: "blood_pressure",
  taken_at: "2026-10-06T08:00:00Z",
  systolic: 130,
  diastolic: 80,
  pulse_bpm: null,
  glucose_mmol_l: null,
  glucose_context: null,
  weight_kg: null,
  validation_status: "valid",
  source: "manual",
};
const r = (o: Partial<WeeklyReading>): WeeklyReading => ({ ...base, ...o });

describe("buildWeeklySummary", () => {
  it("handles no readings without inventing numbers", () => {
    const s = buildWeeklySummary([], NOW);
    expect(s.loggedDays).toBe(0);
    expect(s.thisWeek.bp).toBeNull();
    expect(s.bpAverageChange).toBeNull();
  });

  it("splits this week from last week and reports the BP difference", () => {
    const s = buildWeeklySummary(
      [
        r({ systolic: 140, diastolic: 90, taken_at: "2026-10-06T08:00:00Z" }),
        r({ systolic: 130, diastolic: 84, taken_at: "2026-09-30T08:00:00Z" }),
      ],
      NOW,
    );
    expect(s.thisWeek.bp?.count).toBe(1);
    expect(s.lastWeek.bp?.count).toBe(1);
    expect(s.bpAverageChange).toEqual({ systolic: 10, diastolic: 6 });
  });

  it("gives no change when last week had no BP", () => {
    const s = buildWeeklySummary([r({})], NOW);
    expect(s.bpAverageChange).toBeNull();
  });

  it("counts distinct Lagos days, not readings", () => {
    const s = buildWeeklySummary(
      [
        r({ taken_at: "2026-10-06T07:00:00Z" }),
        r({ taken_at: "2026-10-06T18:00:00Z" }),
        r({ taken_at: "2026-10-04T07:00:00Z" }),
      ],
      NOW,
    );
    expect(s.loggedDays).toBe(2);
  });

  it("uses Lagos time at the day boundary (23:30Z is already tomorrow in Lagos)", () => {
    const s = buildWeeklySummary(
      [r({ taken_at: "2026-10-05T23:30:00Z" }), r({ taken_at: "2026-10-06T00:30:00Z" })],
      NOW,
    );
    expect(s.loggedDays).toBe(1);
  });

  it("does not count unvalidated readings as a logged day", () => {
    const s = buildWeeklySummary([r({ validation_status: "requires_validation" })], NOW);
    expect(s.loggedDays).toBe(0);
  });

  it("excludes readings older than 14 days and future ones", () => {
    const s = buildWeeklySummary(
      [r({ taken_at: "2026-09-01T08:00:00Z" }), r({ taken_at: "2026-10-09T08:00:00Z" })],
      NOW,
    );
    expect(s.thisWeek.totalConsidered).toBe(0);
    expect(s.lastWeek.totalConsidered).toBe(0);
  });

  it("withholds the BP comparison when the data is partial", () => {
    const rows = [
      r({ systolic: 140, diastolic: 90, taken_at: "2026-10-06T08:00:00Z" }),
      r({ systolic: 130, diastolic: 84, taken_at: "2026-09-30T08:00:00Z" }),
    ];
    const s = buildWeeklySummary(rows, NOW, { partial: true });
    expect(s.partial).toBe(true);
    expect(s.bpAverageChange).toBeNull();
    expect(s.thisWeek.bp?.count).toBe(1);
  });
});
