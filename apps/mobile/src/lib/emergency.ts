import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import { PLATFORM_URL } from "./platform-url";

export interface EmergencyContact {
  name: string;
  phone: string | null;
  relationship: string | null;
}

export interface EmergencyMedication {
  drugName: string;
  dose: string | null;
  frequency: string | null;
}

export interface EmergencyFacts {
  fullName: string | null;
  bloodGroup: string | null;
  genotype: string | null;
  allergies: { allergen: string; reaction: string | null; severity: string | null }[];
  conditions: string[];
  medications: EmergencyMedication[];
  emergencyContact: EmergencyContact | null;
  cachedAt: string;
}

const CACHE_KEY = "emergency-card-cache-v1";

/** Mirrors loadEmergencyDatasetForPatient in
 * apps/web/src/lib/emergency/dataset.ts (the printed/offline-card query, not
 * the anon share-link RPC) — every table here already has RLS admitting the
 * patient's own row, so this is a plain client read. */
export async function loadEmergencyFacts(patientId: string): Promise<EmergencyFacts> {
  const [{ data: profile }, { data: allergies }, { data: carePlans }, { data: blood }, { data: meds }, { data: choices }] =
    await Promise.all([
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
      supabase
        .from("medications")
        .select("drug_name, dose, frequency")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .order("drug_name"),
      // S43: the details the person chose to put on their card. No row means nothing was chosen, so nothing is hidden.
      supabase
        .from("emergency_card_fields")
        .select("show_allergies, show_medications, show_conditions, show_blood, show_emergency_contact")
        .eq("patient_id", patientId)
        .maybeSingle(),
    ]);

  const facts: EmergencyFacts = {
    fullName: profile?.full_name ?? null,
    bloodGroup: blood?.blood_group ?? null,
    genotype: blood?.genotype ?? null,
    allergies: allergies ?? [],
    conditions: [...new Set((carePlans ?? []).map((c) => c.condition as string))],
    medications: (meds ?? []).map((m) => ({
      drugName: m.drug_name,
      dose: m.dose ?? null,
      frequency: m.frequency ?? null,
    })),
    emergencyContact: profile?.emergency_contact_name
      ? {
          name: profile.emergency_contact_name,
          phone: profile.emergency_contact_phone,
          relationship: profile.emergency_contact_relationship,
        }
      : null,
    cachedAt: new Date().toISOString(),
  };

  const chosen = applyEmergencyFieldChoices(facts, choices ?? null);

  // Best-effort cache for offline use — this is the one screen in the app
  // that must render with zero signal, per docs/MOBILE_APP_SPEC.md §6.
  // The cache holds what the person chose to show, never more: a hidden field must not sit on the phone either.
  SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(chosen)).catch(() => {});
  return chosen;
}

export interface EmergencyFieldChoicesRow {
  show_allergies: boolean;
  show_medications: boolean;
  show_conditions: boolean;
  show_blood: boolean;
  show_emergency_contact: boolean;
}

/** Removes what the person chose not to show (S43, spec 2.7). The web card and the live link apply the same choices. */
export function applyEmergencyFieldChoices(facts: EmergencyFacts, row: EmergencyFieldChoicesRow | null): EmergencyFacts {
  if (!row) return facts;
  return {
    ...facts,
    allergies: row.show_allergies ? facts.allergies : [],
    medications: row.show_medications ? facts.medications : [],
    conditions: row.show_conditions ? facts.conditions : [],
    bloodGroup: row.show_blood ? facts.bloodGroup : null,
    genotype: row.show_blood ? facts.genotype : null,
    emergencyContact: row.show_emergency_contact ? facts.emergencyContact : null,
  };
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
