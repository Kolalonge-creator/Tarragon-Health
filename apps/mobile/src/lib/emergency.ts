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
  /** Details the person chose not to put on the card (S43). Shown as "not shared", never as "none". Absent in an older cache. */
  hidden?: ("allergies" | "medications" | "conditions" | "blood" | "emergency_contact" | "reproductive" | "mental_health")[];
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
      // S43/S47: the details the person chose to put on their card. No row means nothing was chosen, so the DEFAULTS apply (conditions, reproductive and mental health off).
      supabase
        .from("emergency_card_fields")
        .select("show_allergies, show_medications, show_conditions, show_blood, show_emergency_contact, show_reproductive, show_mental_health")
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
  /** S47: off until chosen. Absent in a row read before the column existed, which counts as off. */
  show_reproductive?: boolean;
  show_mental_health?: boolean;
}

/** What the card shows before the person has chosen anything (S47). Mirrors DEFAULT_CHOICES on the web and the column defaults in the database. */
export const DEFAULT_EMERGENCY_FIELD_CHOICES: Required<EmergencyFieldChoicesRow> = {
  show_allergies: true,
  show_medications: true,
  show_conditions: false,
  show_blood: true,
  show_emergency_contact: true,
  show_reproductive: false,
  show_mental_health: false,
};

/** Mirrors private.emergency_card_sensitive_condition; a web Jest test fails if these drift from the migration. */
export const EMERGENCY_REPRODUCTIVE_PATTERN = /(pregnan|antenatal|postnatal|fertil|contracepti|menstru|menopaus|reproduct|obstetric|gynae|gynec)/i;
export const EMERGENCY_MENTAL_HEALTH_PATTERN = /(mental|depress|anxiet|psych|bipolar|schizo|suicid|self.?harm|ptsd|trauma|panic|mood)/i;

/** Removes what the person chose not to show (S43, spec 2.7). The web card and the live link apply the same choices. */
export function applyEmergencyFieldChoices(facts: EmergencyFacts, chosen: EmergencyFieldChoicesRow | null): EmergencyFacts {
  const row = { ...DEFAULT_EMERGENCY_FIELD_CHOICES, ...(chosen ?? {}) };
  const hidden: NonNullable<EmergencyFacts["hidden"]> = [];
  if (!row.show_allergies) hidden.push("allergies");
  if (!row.show_medications) hidden.push("medications");
  if (!row.show_conditions) hidden.push("conditions");
  if (!row.show_blood) hidden.push("blood");
  if (!row.show_emergency_contact) hidden.push("emergency_contact");
  if (!row.show_reproductive) hidden.push("reproductive");
  if (!row.show_mental_health) hidden.push("mental_health");
  return {
    ...facts,
    hidden,
    allergies: row.show_allergies ? facts.allergies : [],
    medications: row.show_medications ? facts.medications : [],
    conditions: row.show_conditions
      ? facts.conditions.filter((c) => (EMERGENCY_REPRODUCTIVE_PATTERN.test(c) ? row.show_reproductive : EMERGENCY_MENTAL_HEALTH_PATTERN.test(c) ? row.show_mental_health : true))
      : [],
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
