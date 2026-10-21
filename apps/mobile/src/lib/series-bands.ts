import AsyncStorage from "@react-native-async-storage/async-storage";
import { BAND_MMOL_TO_MGDL, glucoseTrendBand, trendBandsEligible, weightTrendBand, type GlucoseDisplayUnit } from "@tarragon/shared";
import { supabase } from "./supabase";
import type { SeriesBand, SeriesReading } from "./series-band-model";

/**
 * Glucose and weight readings for the phone's trend charts, with the target band when one may be drawn (S47b, v5 4.6). The band follows the platform
 * module `trend_target_bands` (born off while the bands are unconfirmed), an adult who is not pregnant and not in the postnatal year, exactly as on the
 * web (`trendBandsEligible`). Anything unknown means no band, never a guessed one. The last answer is remembered so the chart still behaves the same
 * with no signal; an answer never learned is "no band".
 */
export type SeriesKind = "glucose" | "weight";

const MODULE_KEY = "trend_target_bands";
const cacheKey = (userId: string) => `@tarragon/trend-bands-eligible/v1:${userId}`;
const DAY_MS = 86_400_000;

export async function readBandsEligible(subjectId: string): Promise<boolean> {
  try {
    const [mod, prof, preg, post] = await Promise.all([
      supabase.from("platform_modules").select("is_enabled").eq("key", MODULE_KEY).maybeSingle(),
      supabase.from("profiles").select("date_of_birth, is_pregnant").eq("id", subjectId).maybeSingle(),
      supabase.from("patient_pregnancy").select("is_pregnant").eq("patient_id", subjectId).maybeSingle(),
      supabase.from("postnatal_profiles").select("delivery_date").eq("patient_id", subjectId).order("delivery_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (mod.error || prof.error || preg.error || post.error || !prof.data) throw new Error("unreadable");
    const answer = trendBandsEligible({
      moduleEnabled: mod.data?.is_enabled === true,
      dateOfBirth: prof.data.date_of_birth,
      isPregnant: prof.data.is_pregnant === true || preg.data?.is_pregnant === true,
      lastDeliveryDate: post.data?.delivery_date ?? null,
    });
    await AsyncStorage.setItem(cacheKey(subjectId), String(answer)).catch(() => undefined);
    return answer;
  } catch {
    try {
      return (await AsyncStorage.getItem(cacheKey(subjectId))) === "true";
    } catch {
      return false;
    }
  }
}

async function readHeightCm(subjectId: string): Promise<number | null> {
  try {
    const { data } = await supabase.from("profiles").select("height_cm").eq("id", subjectId).maybeSingle();
    return typeof data?.height_cm === "number" ? data.height_cm : null;
  } catch {
    return null;
  }
}

export interface SeriesLoad {
  readings: SeriesReading[];
  /** Null when no band applies. */
  band: SeriesBand | null;
}

/** mmol/L is what is stored; glucose is plotted in the reader's own unit so the axis, the words and the band all say the same number. */
export async function loadSeries(subjectId: string, kind: SeriesKind, unit: GlucoseDisplayUnit, windowDays: number, nowMs: number = Date.now()): Promise<SeriesLoad | null> {
  const since = new Date(nowMs - windowDays * DAY_MS).toISOString();
  const column = kind === "glucose" ? "glucose_mmol_l" : "weight_kg";
  const { data, error } = await supabase
    .from("vitals_readings")
    .select(`taken_at, ${column}`)
    .eq("patient_id", subjectId)
    .eq("vital_type", kind)
    .is("correction_status", null)
    .gte("taken_at", since)
    .order("taken_at", { ascending: false })
    .limit(2000);
  if (error || !data) return null;
  // Newest first, so a person with thousands of device readings keeps the latest ones; the chart sorts them left to right itself.
  const rows = data as unknown as Record<string, string | number | null>[];
  const readings: SeriesReading[] = rows.flatMap((r) => {
    const raw = r[column];
    const takenAt = r["taken_at"];
    if (typeof raw !== "number" || typeof takenAt !== "string") return [];
    return [{ atMs: Date.parse(takenAt), value: kind === "glucose" && unit === "mg_dl" ? Math.round(raw * BAND_MMOL_TO_MGDL) : raw }];
  });
  if (readings.length === 0) return { readings, band: null };
  if (!(await readBandsEligible(subjectId))) return { readings, band: null };
  const band = kind === "glucose" ? glucoseTrendBand(unit) : weightTrendBand(await readHeightCm(subjectId));
  return { readings, band };
}
