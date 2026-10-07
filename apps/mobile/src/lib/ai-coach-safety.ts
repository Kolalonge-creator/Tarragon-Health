import {
  buildEmergencyAddendum,
  nearestHospitalsShown,
  normaliseState,
  mergeHospitalReads,
  rankHospitals,
  type EmergencyAddendumInput,
} from "@tarragon/shared";
import { supabase } from "./supabase";
import { postCoachReport } from "./api";

/**
 * S52 (7.8, 7.9, 7.12) on the phone. The emergency guidance itself is bundled (`@tarragon/shared` assistant-emergency.ts) so it shows with
 * no signal; this file only adds what can be read when there IS a signal: the nearest hospitals and the patient's own emergency contact
 * (their own profile, the shared facilities directory), the report-an-answer call, and the patient's own memory (RLS patient only).
 */
export async function loadEmergencyContext(userId: string): Promise<EmergencyAddendumInput> {
  const empty: EmergencyAddendumInput = { hospitals: [], contactName: null, contactPhone: null };
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("state, city, emergency_contact_name, emergency_contact_phone")
      .eq("id", userId)
      .maybeSingle();
    const state = normaliseState(profile?.state);
    let hospitals: EmergencyAddendumInput["hospitals"] = [];
    if (state) {
      // Rank BEFORE any cap: the patient's own city is asked for by name, the rest of the state is read verified-first, then rankHospitals
      // orders the union. Each read is capped on its own, so an alphabetical limit can never cut off the patient's own city.
      const stateLike = `%${state.replace(/[%_\\]/g, "")}%`;
      const base = () =>
        supabase
          .from("facilities")
          .select("name, city, address, contact_phone, verified, state")
          .eq("type", "hospital")
          .eq("is_active", true)
          .ilike("state", stateLike);
      const city = (profile?.city ?? "").trim().replace(/[%_\\]/g, "");
      const [own, others] = await Promise.all([
        city ? base().ilike("city", city).order("verified", { ascending: false }).order("name", { ascending: true }).limit(100) : Promise.resolve({ data: [] }),
        base().order("verified", { ascending: false }).order("name", { ascending: true }).limit(100),
      ]);
      hospitals = rankHospitals(mergeHospitalReads(own.data, others.data), profile?.city, nearestHospitalsShown());
    }
    return { hospitals, contactName: profile?.emergency_contact_name?.trim() || null, contactPhone: profile?.emergency_contact_phone?.trim() || null };
  } catch {
    return empty;
  }
}

export async function emergencyAddendum(userId: string): Promise<string> {
  return buildEmergencyAddendum(await loadEmergencyContext(userId));
}

export type ReportCategory =
  | "incorrect_information"
  | "inappropriate_recommendation"
  | "missed_escalation"
  | "fabricated_citation"
  | "privacy_concern"
  | "other";

export const REPORT_REASONS: { value: ReportCategory; label: string }[] = [
  { value: "incorrect_information", label: "The information was wrong" },
  { value: "inappropriate_recommendation", label: "The advice did not feel right" },
  { value: "missed_escalation", label: "It missed something urgent" },
  { value: "fabricated_citation", label: "It referred to something that does not exist" },
  { value: "privacy_concern", label: "It said something about me it should not have" },
  { value: "other", label: "Something else" },
];

export async function reportCoachAnswer(category: ReportCategory, description: string, interactionId: string) {
  return postCoachReport(category, description, interactionId);
}

// ---- memory (spec 7.12): the patient's own goals and preferences, consent first, off by default -------------------------------------
export interface MemoryItem {
  id: string;
  kind: "goal" | "preference";
  text: string;
}

export interface MemoryState {
  available: boolean;
  consented: boolean;
  maxItems: number;
  maxChars: number;
  items: MemoryItem[];
}

/** The database's own refusals, in words a patient can act on. */
export function friendlyMemoryError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("assistant_memory_clinical_content")) return "Keep this to a goal or a preference. Health details stay in your record.";
  if (m.includes("assistant_memory_too_long")) return "That is a little long. Please shorten it.";
  if (m.includes("assistant_memory_full")) return "You have reached the limit. Remove one first.";
  if (m.includes("assistant_memory_consent_required")) return "Switch the memory on first.";
  if (m.includes("assistant_memory_not_available")) return "The memory is not switched on yet.";
  return "Something went wrong. Please try again.";
}

export async function loadMemoryState(): Promise<MemoryState | null> {
  const { data: state, error } = await supabase.rpc("assistant_memory_state");
  if (error || !state || typeof state !== "object" || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;
  const { data: items } = await supabase.from("assistant_memory_items").select("id, kind, text").order("created_at");
  return {
    available: s.available === true,
    consented: s.consented === true,
    maxItems: Number(s.max_items ?? 30),
    maxChars: Number(s.max_chars ?? 200),
    items: (items ?? []).filter((i): i is MemoryItem => i.kind === "goal" || i.kind === "preference"),
  };
}

export async function setMemoryConsent(granted: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("assistant_memory_set_consent", { p_granted: granted });
  return error ? friendlyMemoryError(error.message) : null;
}

export async function addMemoryItem(kind: "goal" | "preference", text: string): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not signed in";
  const { error } = await supabase.from("assistant_memory_items").insert({ patient_id: user.id, kind, text: text.trim() });
  return error ? friendlyMemoryError(error.message) : null;
}

export async function updateMemoryItem(id: string, text: string): Promise<string | null> {
  const { error } = await supabase.from("assistant_memory_items").update({ text: text.trim() }).eq("id", id);
  return error ? friendlyMemoryError(error.message) : null;
}

export async function deleteMemoryItem(id: string): Promise<string | null> {
  const { error } = await supabase.from("assistant_memory_items").delete().eq("id", id);
  return error ? friendlyMemoryError(error.message) : null;
}

export async function deleteAllMemory(): Promise<string | null> {
  const { error } = await supabase.rpc("assistant_memory_delete_all");
  return error ? friendlyMemoryError(error.message) : null;
}

export async function exportMemory(): Promise<{ json: string } | { error: string }> {
  const { data, error } = await supabase.rpc("assistant_memory_export");
  if (error || data === null) return { error: "Could not export just now. Please try again." };
  return { json: JSON.stringify(data, null, 2) };
}
