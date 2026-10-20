import type * as SQLite from "expo-sqlite";
import { expandFoodList, isValidGtin, normaliseBarcode, parseBarcodeLookup, type BarcodeLookup, type CompactFoodList, type FoodCatalogueItem } from "@tarragon/shared";
import { supabase } from "./supabase";
import { API_BASE_URL, fetchWithTimeoutAndRetry, getNutritionGuidance } from "./api";
import { enqueue, flushOutbox } from "./outbox";
import { getStoreWithSchema } from "./secure-db";
import { recordSyncError } from "./sync-diagnostics";
import { parseGuidance, type Guidance, type MealType } from "./food-diary-model";

/**
 * Food diary IO on the phone (S49a, v5 6.1 to 6.5).
 *
 *  - The food list is kept on the device (compressed download, only fetched again when its version changes) so pick-from-list works with no signal.
 *  - A meal in words, a one-tap repeat and a favourite all go through the offline outbox (S06): durable on the phone first, idempotent on the
 *    server by client id. Only words are sent; the server recomputes the nutrition.
 *  - Favourites are cached on the device per account so they can be logged offline. Saving or removing one needs a connection.
 *  - Targets are NEVER cached: whether they may be shown can change (a new pregnancy, a clinician hold), so offline the answer is "show nothing".
 *  - Camera barcode scanning needs a camera-scanner native module that this app does not include yet; typing the number works today.
 */

async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `create table if not exists food_cache (
      key text not null,
      owner text not null,
      value text not null,
      updated_at text not null,
      primary key (key, owner)
    );`
  );
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema("food-diary:v1", setup);
}

async function readCache(key: string, owner: string): Promise<string | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("select value from food_cache where key = ? and owner = ?", [key, owner]);
    return row?.value ?? null;
  } catch (error) {
    recordSyncError("food_diary", `readCache:${key}`, error);
    return null;
  }
}

async function writeCache(key: string, owner: string, value: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("insert or replace into food_cache (key, owner, value, updated_at) values (?, ?, ?, ?)", [key, owner, value, new Date().toISOString()]);
  } catch (error) {
    recordSyncError("food_diary", `writeCache:${key}`, error);
  }
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

// --- the food list ----------------------------------------------------------------------------------------------------------------

export type FoodListSource = "network" | "cache" | "none";

function readList(text: string | null): CompactFoodList | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as CompactFoodList;
    return parsed && typeof parsed.version === "string" && Array.isArray(parsed.rows) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The food list: from the network when it changed, else from the copy on the phone. A failed or empty download never replaces a good copy.
 * With no copy and no signal the list is empty and typing still works.
 */
export async function loadFoodList(): Promise<{ foods: FoodCatalogueItem[]; source: FoodListSource }> {
  const cached = readList(await readCache("food_list", ""));
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/nutrition/food-list`, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}`, ...(cached ? { "If-None-Match": `"${cached.version}"` } : {}) },
      });
      if (response.status === 304 && cached) return { foods: expandFoodList(cached), source: "network" };
      if (response.ok) {
        const fresh = readList(await response.text());
        if (fresh && fresh.rows.length > 0) {
          await writeCache("food_list", "", JSON.stringify(fresh));
          return { foods: expandFoodList(fresh), source: "network" };
        }
      }
    }
  } catch {
    // offline or a bad reply: fall through to the copy on the phone
  }
  return cached ? { foods: expandFoodList(cached), source: "cache" } : { foods: [], source: "none" };
}

// --- logging a meal in words, offline-first ---------------------------------------------------------------------------------------

/**
 * Durable on the phone the moment this resolves, whatever the signal. The send happens in the background; the meal shows in the server list
 * after the next sync. Used for typed meals, one-tap repeats and favourites alike.
 */
export async function queueMeal(subjectId: string, input: { mealType: MealType; description: string }): Promise<{ queued: true }> {
  await enqueue({ kind: "meal", subjectId, payload: { meal_type: input.mealType, description: input.description.trim() } });
  void flushOutbox().catch((error) => recordSyncError("food_diary", "flushAfterMeal", error));
  return { queued: true };
}

// --- favourites -------------------------------------------------------------------------------------------------------------------

export interface Favourite {
  id: string;
  name: string;
  description: string;
  mealType: MealType | null;
}

export async function loadFavourites(patientId: string): Promise<{ favourites: Favourite[]; fromCache: boolean }> {
  const { data, error } = await supabase
    .from("favourite_meals")
    .select("id, name, description, meal_type")
    .eq("patient_id", patientId)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error || !data) {
    const cached = await readCache("favourites", patientId);
    try {
      return { favourites: cached ? (JSON.parse(cached) as Favourite[]) : [], fromCache: true };
    } catch {
      return { favourites: [], fromCache: true };
    }
  }
  const favourites: Favourite[] = data.map((r) => ({ id: r.id, name: r.name, description: r.description, mealType: (r.meal_type as MealType | null) ?? null }));
  await writeCache("favourites", patientId, JSON.stringify(favourites));
  return { favourites, fromCache: false };
}

export async function saveFavourite(patientId: string, input: { name: string; description: string; mealType: MealType | null }): Promise<{ error?: string }> {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name) return { error: "Give this meal a short name." };
  if (!description) return { error: "Describe what is in this meal." };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", patientId).maybeSingle();
  if (!profile?.organisation_id) return { error: "We could not save that right now. Check your connection and try again." };
  const { error } = await supabase.from("favourite_meals").insert({
    organisation_id: profile.organisation_id,
    patient_id: patientId,
    name,
    description,
    meal_type: input.mealType,
  });
  if (error) return { error: error.code === "23505" ? "You already have a favourite with that name." : "We could not save that right now. Check your connection and try again." };
  return {};
}

export async function removeFavourite(patientId: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("favourite_meals").delete().eq("id", id).eq("patient_id", patientId);
  return error ? { error: "We could not remove that right now. Check your connection and try again." } : {};
}

// --- targets ----------------------------------------------------------------------------------------------------------------------

/** Today's targets, or `hidden` (show nothing at all). Offline is hidden on purpose: this answer is never cached. */
export async function loadGuidance(): Promise<Guidance> {
  try {
    return parseGuidance(await getNutritionGuidance());
  } catch {
    return { state: "hidden" };
  }
}

// --- barcode ----------------------------------------------------------------------------------------------------------------------

/** Looks up a typed product code in the team-curated Nigerian packaged-food list. Needs a connection; the check digit is verified here first. */
export async function lookupBarcode(rawCode: string): Promise<{ result: BarcodeLookup } | { error: string }> {
  const code = normaliseBarcode(rawCode);
  if (!isValidGtin(code)) return { result: { status: "invalid" } };
  const userId = await currentUserId();
  if (!userId) return { error: "Sign in to look up a product." };
  const { data, error } = await supabase.rpc("lookup_barcode" as never, { p_code: code } as never);
  if (error) return { error: "We could not look that up right now. You can still type what you ate." };
  return { result: parseBarcodeLookup(data) };
}
