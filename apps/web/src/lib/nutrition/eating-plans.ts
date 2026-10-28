import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseEatingGuidance, type EatingGuidance } from "@tarragon/shared";

/**
 * Swaps and condition eating plans for the signed-in patient (S50a, v5 6.8 and 6.9).
 *
 * The database decides (`my_nutrition_guidance()`); "not signed yet" and "not for you" are the same `unavailable` answer. `signed` is a
 * separate, global fact (`nutrition_guidance_is_signed()`) that says nothing about the caller. It exists only so the older built-in swap
 * hints (substitutions.ts) can keep working until a signed table exists, and stop being used the moment one does, so that a person the
 * signed table withholds never falls back to the old hints.
 *
 * Any failure is the safe direction: signed, unavailable (so neither the plans nor the old hints appear), logged, never shown as an empty card.
 */
export interface EatingView {
  signed: boolean;
  guidance: EatingGuidance;
  /** The database answer exactly as the gate returned it (what the phone parses). Null when nothing was asked or the call failed. */
  raw: unknown;
  /** True when a database call failed. The apps then show nothing, but a phone must NOT treat this as a real "unavailable" answer. */
  failed: boolean;
}

const UNAVAILABLE_RAW = { state: "unavailable" } as const;

export async function loadEatingGuidance(supabase: SupabaseClient<Database>): Promise<EatingView> {
  const signedRes = await supabase.rpc("nutrition_guidance_is_signed");
  if (signedRes.error || typeof signedRes.data !== "boolean") {
    console.error("nutrition: could not tell if swaps are signed, showing none", signedRes.error?.message);
    return { signed: true, guidance: { state: "unavailable" }, raw: null, failed: true };
  }
  if (!signedRes.data) return { signed: false, guidance: { state: "unavailable" }, raw: UNAVAILABLE_RAW, failed: false };
  const res = await supabase.rpc("my_nutrition_guidance");
  if (res.error) {
    console.error("nutrition: eating plans gate failed, showing none", res.error.message);
    return { signed: true, guidance: { state: "unavailable" }, raw: null, failed: true };
  }
  return { signed: true, guidance: parseEatingGuidance(res.data), raw: res.data, failed: false };
}
