import { supabase } from "./supabase";
import { postVitalReading, type VitalReadingPayload } from "./api";
import { classifyBpLevel, type BpLevel } from "./bp-classification";

export interface BpReading {
  id: string;
  systolic: number;
  diastolic: number;
  takenAt: string;
  level: BpLevel;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadRecentBpReadings(patientId: string, limit = 10): Promise<BpReading[]> {
  const { data } = await supabase
    .from("vitals_readings")
    .select("id, systolic, diastolic, taken_at")
    .eq("patient_id", patientId)
    .eq("vital_type", "blood_pressure")
    .order("taken_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .filter((r): r is typeof r & { systolic: number; diastolic: number } => r.systolic !== null && r.diastolic !== null)
    .map((r) => ({
      id: r.id,
      systolic: r.systolic,
      diastolic: r.diastolic,
      takenAt: r.taken_at,
      level: classifyBpLevel(r.systolic, r.diastolic),
    }));
}

export interface SevenDayAverage {
  systolic: number;
  diastolic: number;
  readingCount: number;
}

export function computeSevenDayAverage(readings: BpReading[]): SevenDayAverage | null {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const recent = readings.filter((r) => new Date(r.takenAt).getTime() >= cutoff);
  if (recent.length === 0) return null;
  const sys = Math.round(recent.reduce((sum, r) => sum + r.systolic, 0) / recent.length);
  const dia = Math.round(recent.reduce((sum, r) => sum + r.diastolic, 0) / recent.length);
  return { systolic: sys, diastolic: dia, readingCount: recent.length };
}

/** Goes through the API (not a direct insert) so a dangerous reading
 * triggers the same BP-control/health-score reassessment a web-logged one
 * does — see apps/web/src/app/api/mobile/vitals/route.ts. */
export async function logBpReading(systolic: number, diastolic: number): Promise<{ error?: string }> {
  const result = await postVitalReading({ vital_type: "blood_pressure", systolic, diastolic });
  return result.success ? {} : { error: result.error };
}

/** Glucose/weight/temperature/SpO2/pulse quick-log (MOBILE_APP_SPEC.md §2.2) —
 * same escalation-preserving API path as logBpReading. */
export async function logOtherVital(
  payload: Exclude<VitalReadingPayload, { vital_type: "blood_pressure" }>
): Promise<{ error?: string }> {
  const result = await postVitalReading(payload);
  return result.success ? {} : { error: result.error };
}
