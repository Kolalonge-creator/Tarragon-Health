import { analyseVitalsTrend } from "./vitals-trend";
import type { Tables } from "@tarragon/shared";

type Row = Pick<
  Tables<"vitals_readings">,
  | "vital_type"
  | "taken_at"
  | "systolic"
  | "diastolic"
  | "glucose_mmol_l"
  | "weight_kg"
  | "pulse_bpm"
  | "temperature_c"
  | "spo2_pct"
>;

function bpReadings(values: [number, number][], startIso = "2026-01-01T00:00:00Z"): Row[] {
  const start = new Date(startIso);
  return values.map(([systolic, diastolic], i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    return {
      vital_type: "blood_pressure",
      taken_at: d.toISOString(),
      systolic,
      diastolic,
      glucose_mmol_l: null,
      weight_kg: null,
      pulse_bpm: null,
      temperature_c: null,
      spo2_pct: null,
    };
  });
}

describe("analyseVitalsTrend", () => {
  it("finds a rising systolic trend from a BP series", () => {
    const finding = analyseVitalsTrend(bpReadings([[130, 80], [145, 88], [162, 95]]), "blood_pressure_systolic");
    expect(finding).not.toBeNull();
    expect(finding!.direction).toBe("rising");
    expect(finding!.consecutiveCount).toBe(3);
    expect(finding!.label).toBe("Systolic blood pressure");
    expect(finding!.unit).toBe("mmHg");
  });

  it("ignores readings of a different vital_type when extracting a metric", () => {
    const readings: Row[] = [
      ...bpReadings([[130, 80], [140, 85]]),
      {
        vital_type: "glucose",
        taken_at: "2026-01-20T00:00:00Z",
        systolic: null,
        diastolic: null,
        glucose_mmol_l: 12,
        weight_kg: null,
        pulse_bpm: null,
        temperature_c: null,
        spo2_pct: null,
      },
    ];
    // Only 2 real BP points -> below MIN_POINTS_FOR_TREND, so this must stay
    // null rather than accidentally picking up the glucose row as a third point.
    expect(analyseVitalsTrend(readings, "blood_pressure_systolic")).toBeNull();
  });

  it("needs fewer than 3 points to report nothing, same MIN_POINTS_FOR_TREND rule as labs", () => {
    expect(analyseVitalsTrend(bpReadings([[130, 80], [140, 85]]), "blood_pressure_systolic")).toBeNull();
  });

  it("marks outside_range only when a patient-specific range is supplied and breached", () => {
    const readings = bpReadings([[120, 80], [135, 85], [150, 92]]);
    const withoutRange = analyseVitalsTrend(readings, "blood_pressure_systolic");
    expect(withoutRange!.significance).not.toBe("outside_range");

    const withRange = analyseVitalsTrend(readings, "blood_pressure_systolic", { low: 90, high: 140 });
    expect(withRange!.significance).toBe("outside_range");
    expect(withRange!.latestOutsideRange).toBe(true);
  });

  it("classifies a fast run as rapid rate of change", () => {
    // +30mmHg over 2 days total span.
    const finding = analyseVitalsTrend(bpReadings([[130, 80], [145, 85], [160, 90]], "2026-01-01T00:00:00Z"), "blood_pressure_systolic");
    // Default weekly spacing above is gradual; override with a same-day-ish run instead.
    const fast = analyseVitalsTrend(
      [
        { vital_type: "blood_pressure", taken_at: "2026-01-01T00:00:00Z", systolic: 130, diastolic: 80, glucose_mmol_l: null, weight_kg: null, pulse_bpm: null, temperature_c: null, spo2_pct: null },
        { vital_type: "blood_pressure", taken_at: "2026-01-02T00:00:00Z", systolic: 150, diastolic: 88, glucose_mmol_l: null, weight_kg: null, pulse_bpm: null, temperature_c: null, spo2_pct: null },
        { vital_type: "blood_pressure", taken_at: "2026-01-03T00:00:00Z", systolic: 175, diastolic: 96, glucose_mmol_l: null, weight_kg: null, pulse_bpm: null, temperature_c: null, spo2_pct: null },
      ],
      "blood_pressure_systolic",
    );
    expect(fast!.rateOfChange).toBe("rapid");
    expect(finding!.rateOfChange).toBe("gradual");
  });
});
