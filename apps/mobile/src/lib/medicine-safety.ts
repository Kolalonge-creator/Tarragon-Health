import { validateRuleSet, type BrandMapEntry, type IngredientRule, parseSupporterDoses, type SupporterDosesView } from "@tarragon/medicines";
import { supabase } from "./supabase";

/**
 * The phone side of S08y: the governed brand mapping, the same-ingredient and interaction-rule switches, the NAFDAC number note,
 * the S28 collection switch and the supporter's "today's doses". Every function fails soft and says so: a failed read is
 * "unknown" (or an error result), never "closed" and never "nothing found", so a failure cannot look like a pass. Adding a medicine
 * is never held up by any of it.
 */

export type SwitchState = "open" | "closed" | "unknown";

async function guard(key: string): Promise<SwitchState> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: key });
    if (error) return "unknown";
    return data === true ? "open" : "closed";
  } catch {
    return "unknown";
  }
}

export const loadDuplicateIngredientCheckState = (): Promise<SwitchState> => guard("medicine_duplicate_ingredient_check");

/** The S28 pharmacy collection flow. A low-supply link is offered only when this is "open". */
export async function loadPharmacyCollectionOpen(): Promise<boolean | null> {
  const state = await guard("prescribing_enabled");
  return state === "unknown" ? null : state === "open";
}

/** The active SIGNED rules, or [] when the switch is closed or no signed set exists; null when the answer could not be read or trusted. */
export async function loadInteractionRules(): Promise<IngredientRule[] | null> {
  try {
    const { data, error } = await supabase.rpc("active_medicine_interaction_rules");
    if (error) return null;
    const doc = data as { status?: string; rules?: unknown } | null;
    if (doc?.status === "closed") return [];
    if (doc?.status !== "ok") return null;
    const checked = validateRuleSet({ rules: doc.rules });
    return checked.ok ? checked.rules : null;
  } catch {
    return null;
  }
}

/** Published (reviewed, active) brand mappings. A failed read is an empty list: it only leaves brand help out. */
export async function loadBrandMap(): Promise<BrandMapEntry[]> {
  try {
    const { data, error } = await supabase
      .from("medicine_brand_generic_map")
      .select("id, brand_name, ingredients, source_citation, reviewed_by, reviewer_name, reviewed_at, is_active")
      .eq("is_active", true)
      .not("reviewed_by", "is", null)
      .limit(1000);
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id,
      brandName: r.brand_name,
      ingredients: r.ingredients,
      sourceCitation: r.source_citation,
      reviewedBy: r.reviewed_by,
      reviewerName: r.reviewer_name,
      reviewedAt: r.reviewed_at,
      isActive: r.is_active,
    }));
  } catch {
    return [];
  }
}

/** Store (or, with a blank, clear) the NAFDAC number noted from a pack. Store only. */
export async function setNafdacNumber(medicationId: string, number: string): Promise<{ error?: string }> {
  try {
    const { error } = await supabase.rpc("set_medication_nafdac_number", { p_medication: medicationId, p_number: number });
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The number the person noted for one medicine, or null (none noted, or it could not be read). */
export async function loadPackNumber(medicationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("medication_pack_numbers").select("nafdac_number").eq("medication_id", medicationId).maybeSingle();
    return error ? null : (data?.nafdac_number ?? null);
  } catch {
    return null;
  }
}

/** A supporter's read-only "today's doses". The database refuses unless the person shared their medicines. */
export async function loadSupporterTodaysDoses(patientId: string): Promise<SupporterDosesView> {
  try {
    const { data, error } = await supabase.rpc("supporter_todays_doses", { p_patient: patientId });
    if (error) return { status: "unreadable" };
    return parseSupporterDoses(data);
  } catch {
    return { status: "unreadable" };
  }
}
