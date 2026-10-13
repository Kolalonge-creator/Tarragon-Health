import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { supabase } from "./supabase";
import { getStoreWithSchema } from "./secure-db";

/**
 * Whether the person is pregnant or in the first weeks after a birth, for the triage engine on the phone.
 * The engine routes both groups to their own lines (BP-P1, P3, P4, P5) instead of the adult bands, and until now the phone
 * always said "not pregnant" (OQ-90). The answer is read from the server when there is signal and kept on the phone per
 * person, so an offline reading is still graded with the last known answer.
 *
 * A read that fails is NOT "not pregnant": the old answer is kept, and with none the engine is told nothing (false),
 * exactly what it was told before this existed. It never throws and never holds a reading back.
 *
 * S06x: pregnancy is among the most sensitive things the phone keeps, so the copy lives in the ENCRYPTED store
 * (table local_obstetric), not in AsyncStorage. A copy an older build left in AsyncStorage is moved across the
 * first time it is read, then removed.
 */
export interface ObstetricCache {
  pregnant: boolean;
  /** Most recent delivery date (YYYY-MM-DD), or null. */
  lastDeliveryDate: string | null;
  fetchedAtMs: number;
}

export interface ObstetricStatus {
  pregnant: boolean;
  postpartum: boolean;
}

const KEY = (subjectId: string) => `@tarragon/obstetric/v1:${subjectId}`;
const DAY_MS = 86_400_000;
/** Used only when the rule set in force predates the setting (the approved set is the source of truth). */
export const FALLBACK_POSTPARTUM_DAYS = 42;

async function setupObstetric(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("create table if not exists local_obstetric (subject_id text primary key, value text not null)");
}

function parseCache(raw: string | null): ObstetricCache | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ObstetricCache>;
    if (typeof v.pregnant !== "boolean" || typeof v.fetchedAtMs !== "number") return null;
    if (v.lastDeliveryDate != null && !Number.isFinite(Date.parse(v.lastDeliveryDate))) return null;
    return { pregnant: v.pregnant, lastDeliveryDate: v.lastDeliveryDate ?? null, fetchedAtMs: v.fetchedAtMs };
  } catch {
    return null;
  }
}

export async function readObstetricCache(subjectId: string): Promise<ObstetricCache | null> {
  try {
    const db = await getStoreWithSchema("obstetric", setupObstetric);
    const row = await db.getFirstAsync<{ value: string }>("select value from local_obstetric where subject_id = ?", [subjectId]);
    const fromStore = parseCache(row?.value ?? null);
    if (fromStore) return fromStore;
    // Move a copy an older build kept in AsyncStorage (plaintext) into the encrypted store, then remove it.
    const legacy = await AsyncStorage.getItem(KEY(subjectId));
    if (legacy === null) return null;
    const parsed = parseCache(legacy);
    if (parsed) await db.runAsync("insert or replace into local_obstetric (subject_id, value) values (?, ?)", [subjectId, JSON.stringify(parsed)]);
    await AsyncStorage.removeItem(KEY(subjectId));
    return parsed;
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
      supabase.from("patient_pregnancy").select("is_pregnant").eq("patient_id", subjectId).maybeSingle(),
      supabase.from("postnatal_profiles").select("delivery_date").eq("patient_id", subjectId).order("delivery_date", { ascending: false }).limit(1),
    ]);
    if (preg.error || post.error) return "failed";
    const row = (post.data as { delivery_date: string }[] | null)?.[0];
    const next: ObstetricCache = {
      pregnant: (preg.data as { is_pregnant: boolean | null } | null)?.is_pregnant === true,
      lastDeliveryDate: row?.delivery_date ?? null,
      fetchedAtMs: nowMs,
    };
    const db = await getStoreWithSchema("obstetric", setupObstetric);
    await db.runAsync("insert or replace into local_obstetric (subject_id, value) values (?, ?)", [subjectId, JSON.stringify(next)]);
    await AsyncStorage.removeItem(KEY(subjectId)); // never leave a plaintext copy behind
    return "updated";
  } catch {
    return "failed";
  }
}
