import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CatalogueEntry } from "@tarragon/medicines";
import { supabase } from "./supabase";

/**
 * The phone side of S53 (spec 8.1, 8.2, 8.7): the medicine catalogue for search-as-you-type, the interaction-check go-live guard,
 * and side-effect notes. The catalogue is small, so the whole active list is fetched once and then kept on the phone: ranking is
 * done locally by `searchCatalogue` in @tarragon/medicines, so a slow or missing connection never blocks adding a medicine
 * (typing a name by hand always works). Every function here fails soft: a failure is "no suggestions", "guard closed", or an
 * error result, never a crash and never a claim that the check passed.
 */

const CACHE_KEY = "tarragon.medicine-catalogue.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let memory: { at: number; rows: CatalogueEntry[] } | null = null;

interface CatalogueRow {
  id: string;
  brand_name: string | null;
  generic_name: string;
  strength: string | null;
  form: string | null;
  nafdac_number: string | null;
  is_verified: boolean;
}

export function catalogueFromRows(rows: readonly CatalogueRow[]): CatalogueEntry[] {
  return rows.map((r) => ({
    id: r.id,
    brandName: r.brand_name,
    genericName: r.generic_name,
    strength: r.strength,
    form: r.form,
    nafdacNumber: r.nafdac_number,
    isVerified: r.is_verified,
  }));
}

async function readCache(now: number): Promise<{ at: number; rows: CatalogueEntry[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; rows?: unknown };
    if (typeof parsed.at !== "number" || !Array.isArray(parsed.rows)) return null;
    if (now - parsed.at > 7 * CACHE_MAX_AGE_MS) return null;
    return { at: parsed.at, rows: parsed.rows as CatalogueEntry[] };
  } catch {
    return null;
  }
}

/** The active catalogue: memory, then the phone's copy if fresh, then the network; a stale copy is used when the network fails. */
export async function loadMedicineCatalogue(now: number = Date.now()): Promise<CatalogueEntry[]> {
  if (memory && now - memory.at < CACHE_MAX_AGE_MS) return memory.rows;
  const cached = await readCache(now);
  if (cached && now - cached.at < CACHE_MAX_AGE_MS) {
    memory = cached;
    return cached.rows;
  }
  try {
    const { data, error } = await supabase
      .from("medicine_catalogue")
      .select("id, brand_name, generic_name, strength, form, nafdac_number, is_verified")
      .eq("is_active", true)
      .order("generic_name")
      .limit(1000);
    if (error) throw error;
    const rows = catalogueFromRows((data ?? []) as CatalogueRow[]);
    memory = { at: now, rows };
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memory));
    } catch {
      // a full or unavailable store only means the next open fetches again
    }
    return rows;
  } catch {
    return cached?.rows ?? memory?.rows ?? [];
  }
}

export function __resetCatalogueCache(): void {
  memory = null;
}

/** Is the interaction and duplication check open for this person (go-live guard, INV-14)? Any error reads as closed. */
export async function loadInteractionCheckOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "interaction_check_enabled" });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** A side-effect note for the next consultation (8.7). Identity and organisation come from the database, not from here. */
export async function addSideEffectNote(medicationId: string, note: string): Promise<{ error?: string }> {
  const text = note.trim();
  if (text.length === 0) return { error: "empty" };
  try {
    const { error } = await supabase.from("medication_side_effect_notes").insert({ medication_id: medicationId, note: text.slice(0, 500) });
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
