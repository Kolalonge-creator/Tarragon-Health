/**
 * Plain statistics over a patient's own logged readings, for the printable
 * "report for your visit". Deliberately no classification (no "high",
 * "normal", "controlled"): a reading is only described, and a clinician reads
 * it. Only `valid` readings are counted; the rest are reported as a count so
 * the page never silently drops data.
 */

export type VisitReportSource = "manual" | "device" | "wearable";

export interface VisitReportReading {
  vital_type: string;
  taken_at: string;
  systolic: number | null;
  diastolic: number | null;
  pulse_bpm: number | null;
  glucose_mmol_l: number | null;
  glucose_context: string | null;
  weight_kg: number | null;
  validation_status: string;
  source: string;
}

export interface Range {
  count: number;
  average: number;
  min: number;
  max: number;
}

export interface BpSummary {
  count: number;
  averageSystolic: number;
  averageDiastolic: number;
  minSystolic: number;
  maxSystolic: number;
  minDiastolic: number;
  maxDiastolic: number;
  latest: { systolic: number; diastolic: number; takenAt: string };
}

export interface WeightSummary {
  count: number;
  first: { kg: number; takenAt: string };
  latest: { kg: number; takenAt: string };
  changeKg: number;
}

export interface VisitReportSummary {
  periodDays: number;
  totalConsidered: number;
  excludedUnvalidated: number;
  sourceCounts: Record<VisitReportSource, number>;
  bp: BpSummary | null;
  glucoseByContext: Array<{ context: string } & Range>;
  pulse: Range | null;
  weight: WeightSummary | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function range(values: number[]): Range | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    average: round1(sum / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const GLUCOSE_ORDER = ["fasting", "post_meal", "random", "bedtime"];

export function summariseReadings(
  readings: VisitReportReading[],
  periodDays: number,
): VisitReportSummary {
  const valid = readings.filter((r) => r.validation_status === "valid");
  const byTime = [...valid].sort((a, b) => a.taken_at.localeCompare(b.taken_at));

  const sourceCounts: Record<VisitReportSource, number> = { manual: 0, device: 0, wearable: 0 };
  for (const r of valid) {
    if (r.source === "manual" || r.source === "device" || r.source === "wearable") {
      sourceCounts[r.source] += 1;
    }
  }

  const bpRows = byTime.filter(
    (r) => r.vital_type === "blood_pressure" && r.systolic != null && r.diastolic != null,
  );
  let bp: BpSummary | null = null;
  if (bpRows.length > 0) {
    const sys = bpRows.map((r) => r.systolic as number);
    const dia = bpRows.map((r) => r.diastolic as number);
    const last = bpRows[bpRows.length - 1]!;
    bp = {
      count: bpRows.length,
      averageSystolic: Math.round(sys.reduce((a, b) => a + b, 0) / sys.length),
      averageDiastolic: Math.round(dia.reduce((a, b) => a + b, 0) / dia.length),
      minSystolic: Math.min(...sys),
      maxSystolic: Math.max(...sys),
      minDiastolic: Math.min(...dia),
      maxDiastolic: Math.max(...dia),
      latest: {
        systolic: last.systolic as number,
        diastolic: last.diastolic as number,
        takenAt: last.taken_at,
      },
    };
  }

  const glucoseGroups = new Map<string, number[]>();
  for (const r of byTime) {
    if (r.vital_type !== "glucose" || r.glucose_mmol_l == null) continue;
    const key = r.glucose_context ?? "random";
    glucoseGroups.set(key, [...(glucoseGroups.get(key) ?? []), r.glucose_mmol_l]);
  }
  const glucoseByContext = [...glucoseGroups.entries()]
    .map(([context, values]) => ({ context, ...(range(values) as Range) }))
    .sort((a, b) => {
      const ai = GLUCOSE_ORDER.indexOf(a.context);
      const bi = GLUCOSE_ORDER.indexOf(b.context);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const pulse = range(
    byTime.filter((r) => r.pulse_bpm != null).map((r) => r.pulse_bpm as number),
  );

  const weightRows = byTime.filter((r) => r.vital_type === "weight" && r.weight_kg != null);
  let weight: WeightSummary | null = null;
  if (weightRows.length > 0) {
    const first = weightRows[0]!;
    const last = weightRows[weightRows.length - 1]!;
    weight = {
      count: weightRows.length,
      first: { kg: first.weight_kg as number, takenAt: first.taken_at },
      latest: { kg: last.weight_kg as number, takenAt: last.taken_at },
      changeKg: round1((last.weight_kg as number) - (first.weight_kg as number)),
    };
  }

  return {
    periodDays,
    totalConsidered: valid.length,
    excludedUnvalidated: readings.length - valid.length,
    sourceCounts,
    bp,
    glucoseByContext,
    pulse,
    weight,
  };
}

export const ALLOWED_PERIOD_DAYS = [7, 30, 90] as const;

/** Anything other than an allowed period falls back to 30. */
export function parsePeriodDays(raw: string | null): number {
  const n = Number(raw);
  return (ALLOWED_PERIOD_DAYS as readonly number[]).includes(n) ? n : 30;
}
