import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import { PLATFORM_URL } from "./platform-url";

export interface EmergencyContact {
  name: string;
  phone: string | null;
  relationship: string | null;
}

export interface EmergencyFacts {
  fullName: string | null;
  bloodGroup: string | null;
  genotype: string | null;
  allergies: { allergen: string; reaction: string | null; severity: string | null }[];
  conditions: string[];
  emergencyContact: EmergencyContact | null;
  cachedAt: string;
}

const CACHE_KEY = "emergency-card-cache-v1";

/** Mirrors loadEmergencyDatasetForPatient in
 * apps/web/src/lib/emergency/dataset.ts (the printed/offline-card query, not
 * the anon share-link RPC) — every table here already has RLS admitting the
 * patient's own row, so this is a plain client read. */
export async function loadEmergencyFacts(patientId: string): Promise<EmergencyFacts> {
  const [{ data: profile }, { data: allergies }, { data: carePlans }, { data: blood }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
      .eq("id", patientId)
      .maybeSingle(),
    supabase
      .from("patient_allergies")
      .select("allergen, reaction, severity")
      .eq("patient_id", patientId)
      .order("severity", { ascending: false, nullsFirst: false })
      .order("allergen"),
    supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
    supabase
      .from("patient_blood_profile")
      .select("blood_group, genotype")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  const facts: EmergencyFacts = {
    fullName: profile?.full_name ?? null,
    bloodGroup: blood?.blood_group ?? null,
    genotype: blood?.genotype ?? null,
    allergies: allergies ?? [],
    conditions: [...new Set((carePlans ?? []).map((c) => c.condition as string))],
    emergencyContact: profile?.emergency_contact_name
      ? {
          name: profile.emergency_contact_name,
          phone: profile.emergency_contact_phone,
          relationship: profile.emergency_contact_relationship,
        }
      : null,
    cachedAt: new Date().toISOString(),
  };

  // Best-effort cache for offline use — this is the one screen in the app
  // that must render with zero signal, per docs/MOBILE_APP_SPEC.md §6.
  SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(facts)).catch(() => {});
  return facts;
}

export async function loadCachedEmergencyFacts(): Promise<EmergencyFacts | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    return raw ? (JSON.parse(raw) as EmergencyFacts) : null;
  } catch {
    return null;
  }
}

export interface ShareLink {
  token: string;
  url: string;
  expiresAt: string;
}

/** The opt-in no-login share link (separate from the always-available
 * offline card above) — apps/web/src/lib/emergency/actions.ts's
 * create_emergency_card()/revoke_emergency_card() RPCs, no arguments, act
 * only on auth.uid(). */
export async function loadActiveShareLink(patientId: string): Promise<ShareLink | null> {
  const { data } = await supabase
    .from("emergency_cards")
    .select("token, expires_at")
    .eq("patient_id", patientId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  return { token: data.token, url: `${PLATFORM_URL}/emergency/${data.token}`, expiresAt: data.expires_at };
}

export async function createShareLink(): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("create_emergency_card");
  return error ? { error: error.message } : {};
}
