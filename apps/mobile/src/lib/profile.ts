import { supabase } from "./supabase";
import { type GlucoseDisplayUnit, type UiLanguage } from "@tarragon/shared";
import { clearGlucoseUnitCache } from "./glucose-unit";
import { clearUiLanguageCache } from "./ui-language";
import type { Tables } from "@tarragon/shared";

export type ProfileRow = Tables<"profiles">;
export type IdentityVerificationRow = Tables<"identity_verifications">;
export type DeletionRequestRow = Tables<"data_deletion_requests">;
export type CorrectionRequestRow = Tables<"data_correction_requests">;

/** Same E.164 shape enforced server-side by emergencyContactSchema
 * (apps/web/src/lib/validation/emergency-contact.ts) — kept in sync manually
 * since the mobile app doesn't share that zod module. */
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone.trim());
}

/** "" -> null so a cleared field actually clears the saved value, matching
 * the `norm()` helper in apps/web/src/app/(dashboard)/patient/actions.ts. */
function norm(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The signed-in patient's own profiles row — RLS scopes this to their own
 * id, so this is a plain select, not an admin lookup. */
export async function loadProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

/** Mirrors useLatestIdentityVerification in apps/web/src/lib/queries/identity.ts. */
export async function loadLatestIdentityVerification(
  userId: string
): Promise<IdentityVerificationRow | null> {
  const { data, error } = await supabase
    .from("identity_verifications")
    .select("*")
    .eq("patient_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Mirrors usePatientDeletionRequests in apps/web/src/lib/queries/data-rights.ts. */
export async function loadDeletionRequests(userId: string): Promise<DeletionRequestRow[]> {
  const { data, error } = await supabase
    .from("data_deletion_requests")
    .select("*")
    .eq("patient_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Mirrors usePatientCorrectionRequests in apps/web/src/lib/queries/data-rights.ts. */
export async function loadCorrectionRequests(userId: string): Promise<CorrectionRequestRow[]> {
  const { data, error } = await supabase
    .from("data_correction_requests")
    .select("*")
    .eq("patient_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Mirrors updatePatientLocation in apps/web/src/app/(dashboard)/patient/actions.ts. */
export async function updateLocation(
  userId: string,
  input: { state: string; city: string; area: string }
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      state: norm(input.state),
      city: norm(input.city),
      area: norm(input.area),
    })
    .eq("id", userId);
  if (error) throw error;
}

/** Mirrors updateConditionLanguagePreference in
 * apps/web/src/app/(dashboard)/patient/condition-language-actions.ts. */
export async function updateConditionLanguage(
  userId: string,
  value: "clinical" | "gentle"
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ condition_language_preference: value })
    .eq("id", userId);
  if (error) throw error;
}

/**
 * The unit this patient reads their own glucose figures in. Display and
 * entry-form default only -- vitals_readings always stores mmol/L, so this
 * never converts a stored reading. See profiles.glucose_display_unit.
 */
export async function updateGlucoseDisplayUnit(
  userId: string,
  value: GlucoseDisplayUnit
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ glucose_display_unit: value })
    .eq("id", userId);
  if (error) throw error;
  // The unit is cached per session for the screens that only read it.
  clearGlucoseUnitCache();
}

/**
 * Interface language. Wayfinding only -- clinical guidance, emergency copy,
 * dosing and consent text are never translated. See profiles.language and
 * packages/shared/src/ui-language.ts.
 */
export async function updateUiLanguage(userId: string, value: UiLanguage): Promise<void> {
  const { error } = await supabase.from("profiles").update({ language: value }).eq("id", userId);
  if (error) throw error;
  clearUiLanguageCache();
}

export interface EmergencyContactInput {
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContactConsent: boolean;
  nextOfKinName: string;
  nextOfKinPhone: string;
}

/** Mirrors updateEmergencyContact in apps/web/src/app/(dashboard)/patient/actions.ts,
 * including the consent stamp/clear behaviour. */
export async function updateEmergencyContact(userId: string, input: EmergencyContactInput): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      emergency_contact_name: norm(input.emergencyContactName),
      emergency_contact_phone: norm(input.emergencyContactPhone),
      emergency_contact_relationship: norm(input.emergencyContactRelationship),
      emergency_contact_consent: input.emergencyContactConsent,
      emergency_contact_consent_at: input.emergencyContactConsent ? new Date().toISOString() : null,
      next_of_kin_name: norm(input.nextOfKinName),
      next_of_kin_phone: norm(input.nextOfKinPhone),
    })
    .eq("id", userId);
  if (error) throw error;
}

/** Mirrors useCreateDeletionRequest in apps/web/src/lib/queries/data-rights.ts.
 * organisation_id/patient_id/status are re-forced server-side by
 * private.enforce_data_deletion_request_attribution regardless of what's
 * sent here — this is a tracked review workflow, not an auto-delete. */
export async function createDeletionRequest(
  organisationId: string,
  patientId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.from("data_deletion_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    reason: norm(reason),
    requested_categories: [],
  });
  if (error) throw error;
}

export interface CorrectionRequestInput {
  recordDescription: string;
  whatIsWrong: string;
  requestedChange?: string;
}

/** Mirrors useCreateCorrectionRequest in apps/web/src/lib/queries/data-rights.ts. */
export async function createCorrectionRequest(
  organisationId: string,
  patientId: string,
  input: CorrectionRequestInput
): Promise<void> {
  const { error } = await supabase.from("data_correction_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    record_description: input.recordDescription,
    what_is_wrong: input.whatIsWrong,
    requested_change: input.requestedChange ? norm(input.requestedChange) : null,
  });
  if (error) throw error;
}
