import { cycleHero } from "./cycle-hero";
import type { CyclePrediction } from "./cycle-prediction";

const p = (o: Partial<CyclePrediction>) => o as CyclePrediction;

describe("cycleHero", () => {
  it("shows no number before a first period", () => {
    expect(cycleHero(p({ predictedNextPeriodDate: null })).value).toBeNull();
  });
  it("counts days to the next period", () => {
    const h = cycleHero(p({ predictedNextPeriodDate: "2026-11-10", isOverdue: false, daysUntilNextPeriod: 5 }));
    expect(h.value).toBe(5);
    expect(h.unit).toBe("days to your period");
  });
  it("singular, today, and inside-the-window", () => {
    expect(cycleHero(p({ predictedNextPeriodDate: "x", isOverdue: false, daysUntilNextPeriod: 1 })).unit).toBe("day to your period");
    expect(cycleHero(p({ predictedNextPeriodDate: "x", isOverdue: false, daysUntilNextPeriod: 0 })).value).toBe("Today");
    expect(cycleHero(p({ predictedNextPeriodDate: "x", isOverdue: false, daysUntilNextPeriod: -2 })).value).toBe("Any day");
  });
  it("says late, never a negative count", () => {
    const h = cycleHero(p({ predictedNextPeriodDate: "x", isOverdue: true, daysOverdue: 3, daysUntilNextPeriod: -3 }));
    expect(h.value).toBe(3);
    expect(h.unit).toBe("days late");
  });
});
