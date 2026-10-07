import AsyncStorage from "@react-native-async-storage/async-storage";
import { gestationalAge } from "@tarragon/clinical";
import { supabase } from "./supabase";

/**
 * Whether the person is pregnant or in the first weeks after a birth, for the triage engine on the phone.
 * The engine routes both groups to their own lines (BP-P1, P3, P4, P5) instead of the adult bands, and until now the phone
 * always said "not pregnant" (OQ-90). The answer is read from the server when there is signal and kept on the phone per
 * person, so an offline reading is still graded with the last known answer.
 *
 * A read that fails is NOT "not pregnant": the old answer is kept, and with none the engine is told nothing (false),
 * exactly what it was told before this existed. It never throws and never holds a reading back.
 */
export interface ObstetricCache {
  pregnant: boolean;
  /** Most recent delivery date (YYYY-MM-DD), or null. */
  lastDeliveryDate: string | null;
  fetchedAtMs: number;
  /**
   * S67 (OQ-90, emergency facts): the dating the pregnancy week is worked out from, kept with the flag so the red pregnancy rules,
   * the week-aware screens and the kick and contraction cards all work with no signal (INV-06). Absent on a copy written before S67.
   */
  lmp?: string | null;
  edd?: string | null;
}

export interface ObstetricStatus {
  pregnant: boolean;
  postpartum: boolean;
}

const KEY = (subjectId: string) => `@tarragon/obstetric/v1:${subjectId}`;
const DAY_MS = 86_400_000;
/** Used only when the rule set in force predates the setting (the approved set is the source of truth). */
export const FALLBACK_POSTPARTUM_DAYS = 42;

export async function readObstetricCache(subjectId: string): Promise<ObstetricCache | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(subjectId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ObstetricCache>;
    if (typeof v.pregnant !== "boolean" || typeof v.fetchedAtMs !== "number") return null;
    if (v.lastDeliveryDate != null && !Number.isFinite(Date.parse(v.lastDeliveryDate))) return null;
    return {
      pregnant: v.pregnant,
      lastDeliveryDate: v.lastDeliveryDate ?? null,
      fetchedAtMs: v.fetchedAtMs,
      lmp: typeof v.lmp === "string" ? v.lmp : null,
      edd: typeof v.edd === "string" ? v.edd : null,
    };
  } catch {
    return null;
  }
}

/** Pure: today (Lagos, UTC+1) against the delivery date. A date in the future is not postpartum. */
export function statusFrom(cache: ObstetricCache | null, nowMs: number, windowDays: number = FALLBACK_POSTPARTUM_DAYS): ObstetricStatus {
  if (!cache) return { pregnant: false, postpartum: false };
  let postpartum = false;
  if (cache.lastDeliveryDate) {
    const today = Math.floor((nowMs + 3_600_000) / DAY_MS);
    const delivered = Math.floor(Date.parse(`${cache.lastDeliveryDate}T00:00:00Z`) / DAY_MS);
    postpartum = delivered <= today && today - delivered < windowDays;
  }
  return { pregnant: cache.pregnant, postpartum };
}

/**
 * Whole gestational weeks today (Lagos day) from the cached dating, or null when she is not pregnant, no date is cached or the
 * date is not usable. Never guesses: an unknown week is null and the screens ask for a due date instead.
 */
export function pregnancyWeekFrom(cache: ObstetricCache | null, nowMs: number): number | null {
  if (!cache || !cache.pregnant) return null;
  const today = new Date(nowMs + 3_600_000).toISOString().slice(0, 10);
  return gestationalAge({ lmp: cache.lmp ?? null, edd: cache.edd ?? null, today })?.weeks ?? null;
}

export async function readPregnancyWeek(subjectId: string, nowMs: number): Promise<number | null> {
  return pregnancyWeekFrom(await readObstetricCache(subjectId), nowMs);
}

export async function readObstetricStatus(subjectId: string, nowMs: number, windowDays?: number): Promise<ObstetricStatus> {
  return statusFrom(await readObstetricCache(subjectId), nowMs, windowDays);
}

/**
 * Online: read both records and keep the answer. Both reads must succeed; one failing keeps the previous copy untouched,
 * because half an answer (pregnant read, delivery unknown) could clear a postpartum flag that is still true.
 */
export async function refreshObstetricStatus(subjectId: string, nowMs: number = Date.now()): Promise<"updated" | "failed"> {
  try {
    const [preg, post] = await Promise.all([
      supabase.from("patient_pregnancy").select("is_pregnant, estimated_due_date, last_menstrual_period_date").eq("patient_id", subjectId).maybeSingle(),
      supabase.from("postnatal_profiles").select("delivery_date").eq("patient_id", subjectId).order("delivery_date", { ascending: false }).limit(1),
    ]);
    if (preg.error || post.error) return "failed";
    const row = (post.data as { delivery_date: string }[] | null)?.[0];
    const p = preg.data as { is_pregnant: boolean | null; estimated_due_date?: string | null; last_menstrual_period_date?: string | null } | null;
    const next: ObstetricCache = {
      pregnant: p?.is_pregnant === true,
      lastDeliveryDate: row?.delivery_date ?? null,
      fetchedAtMs: nowMs,
      lmp: p?.last_menstrual_period_date ?? null,
      edd: p?.estimated_due_date ?? null,
    };
    await AsyncStorage.setItem(KEY(subjectId), JSON.stringify(next));
    return "updated";
  } catch {
    return "failed";
  }
}
