import { readingStatus } from "@/lib/vitals/reading-status";

export interface HeroReadingInput {
  vital_type: string;
  systolic?: number | null;
  diastolic?: number | null;
  taken_at: string;
  source?: string | null;
}

export interface LatestBpHero {
  systolic: number;
  diastolic: number;
  takenAt: string;
  status: { level: "green" | "amber" | "red" | "emergency"; word: string } | null;
  average: { systolic: number; diastolic: number; count: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the Vitals hero shows: the newest blood pressure, its status from the one shared classifier, and the
 * average of the last seven days. Presentation only (web twin of the mobile Vitals hero): it adds no threshold and no wording.
 * A wearable (cuffless) estimate is never graded, averaged or shown as the latest reading, as on mobile.
 */
export function buildLatestBpHero(readings: readonly HeroReadingInput[], now: Date = new Date()): LatestBpHero | null {
  const bp = readings
    .filter((r) => r.vital_type === "blood_pressure" && r.source !== "wearable" && typeof r.systolic === "number" && typeof r.diastolic === "number")
    .sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
  const latest = bp[0];
  if (!latest) return null;
  const systolic = latest.systolic as number;
  const diastolic = latest.diastolic as number;
  const recent = bp.filter((r) => now.getTime() - Date.parse(r.taken_at) <= 7 * DAY_MS);
  const average =
    recent.length > 0
      ? {
          systolic: Math.round(recent.reduce((s, r) => s + (r.systolic as number), 0) / recent.length),
          diastolic: Math.round(recent.reduce((s, r) => s + (r.diastolic as number), 0) / recent.length),
          count: recent.length,
        }
      : null;
  return { systolic, diastolic, takenAt: latest.taken_at, status: readingStatus({ vital_type: "blood_pressure", systolic, diastolic }), average };
}
