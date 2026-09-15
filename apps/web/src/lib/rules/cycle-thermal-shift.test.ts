import { detectThermalShift, type TemperatureReading } from "./cycle-thermal-shift";

/** Readings starting 2026-08-01, one per day, from a list of temperatures. */
function series(temps: number[], from = "2026-08-01"): TemperatureReading[] {
  return temps.map((temperature, i) => {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, temperature };
  });
}

describe("detectThermalShift", () => {
  it("needs at least nine readings before saying anything", () => {
    const result = detectThermalShift(series([36.3, 36.4, 36.3, 36.4, 36.3, 36.4, 36.7, 36.8]));
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("not_enough_readings");
  });

  it("detects a classic three-over-six shift", () => {
    // Six baseline days peaking at 36.4, then three clearly above it.
    const result = detectThermalShift(
      series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.8])
    );
    expect(result.detected).toBe(true);
    expect(result.shiftStartDate).toBe("2026-08-07");
    // Ovulation is dated to the day before the rise.
    expect(result.estimatedOvulationDate).toBe("2026-08-06");
    expect(result.baselineHigh).toBe(36.4);
    expect(result.riseC).toBeCloseTo(0.4, 2);
  });

  it("rejects a rise that is not sustained for three days", () => {
    const result = detectThermalShift(
      series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.35])
    );
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("no_sustained_rise");
  });

  it("rejects a sustained but too-small rise", () => {
    // All three above baseline, but the third is only 0.1 C above it.
    const result = detectThermalShift(
      series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.45, 36.47, 36.5])
    );
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("no_sustained_rise");
  });

  it("accepts a rise exactly at the 0.2 C threshold", () => {
    const result = detectThermalShift(
      series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.45, 36.5, 36.6])
    );
    expect(result.detected).toBe(true);
    expect(result.riseC).toBeCloseTo(0.2, 2);
  });

  it("ignores a one-day fever spike that falls straight back", () => {
    const result = detectThermalShift(
      series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 37.6, 36.3, 36.35])
    );
    expect(result.detected).toBe(false);
  });

  it("sorts unordered readings before interpreting them", () => {
    const ordered = series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.8]);
    const shuffled = [ordered[4], ordered[0], ordered[8], ordered[2], ordered[6], ordered[1], ordered[7], ordered[3], ordered[5]];
    expect(detectThermalShift(shuffled)).toEqual(detectThermalShift(ordered));
  });

  it("finds a shift that happens later in a longer series", () => {
    const result = detectThermalShift(
      series([
        36.3, 36.35, 36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.35,
        36.7, 36.75, 36.8,
      ])
    );
    expect(result.detected).toBe(true);
    expect(result.shiftStartDate).toBe("2026-08-10");
  });

  it("ignores non-numeric readings rather than throwing", () => {
    const withJunk = [
      ...series([36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.8]),
      { date: "2026-08-10", temperature: Number.NaN },
    ];
    expect(detectThermalShift(withJunk).detected).toBe(true);
  });
});
