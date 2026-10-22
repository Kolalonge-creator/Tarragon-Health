import type * as SQLite from "expo-sqlite";
import { getEatingPlans } from "./api";
import { supabase } from "./supabase";
import { getStoreWithSchema } from "./secure-db";
import { recordSyncError } from "./sync-diagnostics";
import { chooseEatingResult, type CachedGuidance, type EatingResult } from "./eating-plans-model";

/**
 * Eating plans, swaps and the dietitian request status on the phone (S50a). Read only. The rules for the saved copy are in
 * eating-plans-model.ts; this file is the IO. The copy lives in the same encrypted store as the rest of the phone's local data, per account.
 */
async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists eating_cache (
      owner text primary key,
      value text not null,
      saved_at text not null
    );`
  );
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema("eating-plans:v1", setup);
}

async function currentUserId(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function readCopy(owner: string): Promise<CachedGuidance | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string; saved_at: string }>("select value, saved_at from eating_cache where owner = ?", [owner]);
    return row ? { json: row.value, savedAt: row.saved_at } : null;
  } catch (error) {
    recordSyncError("food_diary", "readCopy", error);
    return null;
  }
}

async function applyCache(owner: string, cache: EatingResult["cache"]): Promise<void> {
  if (cache.action === "none") return;
  try {
    const db = await getDb();
    if (cache.action === "write") {
      await db.runAsync("insert or replace into eating_cache (owner, value, saved_at) values (?, ?, ?)", [owner, cache.json, new Date().toISOString()]);
    } else {
      await db.runAsync("delete from eating_cache where owner = ?", [owner]);
    }
  } catch (error) {
    recordSyncError("food_diary", `cache:${cache.action}`, error);
  }
}

/** Plans and swaps for the signed-in person, or unavailable (render nothing). */
export async function loadEatingPlans(): Promise<EatingResult> {
  const owner = await currentUserId();
  if (!owner) return { guidance: { state: "unavailable" }, fromCache: false, cache: { action: "none" } };
  let fresh: unknown | null = null;
  try {
    fresh = await getEatingPlans();
  } catch {
    fresh = null;
  }
  const result = chooseEatingResult(fresh, fresh === null ? await readCopy(owner) : null, new Date());
  await applyCache(owner, result.cache);
  return result;
}

/** Whether the screen is showing the signed-in person's OWN account. Plans answer only for the caller, so they are never drawn on a supported person's screen. */
export async function isOwnAccount(patientId: string): Promise<boolean> {
  return (await currentUserId()) === patientId;
}

export interface ReferralStatus {
  status: string;
  requestedAt: string;
}

/** The newest dietitian request, or null (none, or it could not be read: the card then simply does not mention it). */
export async function loadNutritionReferral(patientId: string): Promise<ReferralStatus | null> {
  const { data, error } = await supabase
    .from("nutrition_referrals")
    .select("status, requested_at")
    .eq("patient_id", patientId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error) recordSyncError("food_diary", "loadNutritionReferral", error);
    return null;
  }
  return { status: data.status, requestedAt: data.requested_at };
}
