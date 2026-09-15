import type { Enums, Tables } from "@tarragon/shared";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

export type SymptomType = Enums<"symptom_type">;
export type SymptomLog = Tables<"symptoms">;

/**
 * Adult symptom types only — mirrors ADULT_SYMPTOM_TYPES in
 * apps/web/src/app/(dashboard)/patient/symptom-log-form.tsx (SYMPTOM_TYPES
 * from apps/web/src/lib/validation/symptoms.ts minus the four paediatric-only
 * types). The web form also offers those four (poor_feeding, lethargy,
 * grunting_or_retractions, dehydration_signs) when logging for a dependent
 * under 5 (shouldOfferPaediatricSymptomTypes, keyed off the subject's
 * ageYears) — home-shell.tsx doesn't thread ageYears down to any native
 * screen today and is out of scope for this change, so this deliberately
 * offers only the adult list. Extending to the paediatric set later is a
 * matter of threading ageYears through, not a schema/RLS change.
 */
const ADULT_SYMPTOM_TYPES = [
  "pain",
  "fatigue",
  "breathlessness",
  "dizziness",
  "palpitations",
  "swelling",
  "nausea",
  "chest_pain",
  "severe_headache",
  "visual_disturbance",
  "confusion",
  "testicular_pain",
  "testicular_lump",
  "other",
] as const satisfies readonly SymptomType[];

export type AdultSymptomType = (typeof ADULT_SYMPTOM_TYPES)[number];
export const SYMPTOM_TYPES: readonly AdultSymptomType[] = ADULT_SYMPTOM_TYPES;

/** Mirrors SYMPTOM_LABEL in symptom-log-form.tsx (adult entries only). */
export const SYMPTOM_LABEL: Record<AdultSymptomType, string> = {
  pain: "Pain",
  fatigue: "Fatigue",
  breathlessness: "Breathlessness",
  dizziness: "Dizziness",
  palpitations: "Palpitations (racing/irregular heartbeat)",
  swelling: "Swelling",
  nausea: "Nausea",
  chest_pain: "Chest pain or pressure",
  severe_headache: "Severe headache",
  visual_disturbance: "Vision changes (blurred, dimmed, or lost)",
  confusion: "Confusion or drowsiness",
  testicular_pain: "Testicular pain",
  testicular_lump: "Testicular lump or swelling",
  other: "Other",
};

/** The four paediatric-only types (see ADULT_SYMPTOM_TYPES above) — not
 * offered by the log form on this screen, but a history row can still be one
 * of these if it was logged from web for a dependent under 5, so display
 * needs a label for them too. Mirrors PAEDIATRIC_SYMPTOM_LABEL in
 * apps/web/src/lib/rules/pediatric-symptom-triage.ts. */
const PAEDIATRIC_SYMPTOM_LABEL: Record<
  "poor_feeding" | "lethargy" | "grunting_or_retractions" | "dehydration_signs",
  string
> = {
  poor_feeding: "Feeding much less than usual, or refusing to feed",
  lethargy: "Unusually sleepy, floppy, or hard to wake",
  grunting_or_retractions: "Grunting, or the chest pulling in with each breath",
  dehydration_signs: "Fewer wet nappies, dry mouth, or no tears when crying",
};

/** Label lookup covering every symptom_type value, including the paediatric
 * ones this screen's form never writes — used for rendering history, which
 * can contain either. */
export function symptomLabel(type: SymptomType): string {
  return (
    (SYMPTOM_LABEL as Record<string, string>)[type] ??
    PAEDIATRIC_SYMPTOM_LABEL[type as keyof typeof PAEDIATRIC_SYMPTOM_LABEL] ??
    type.replace(/_/g, " ")
  );
}

/**
 * One-touch danger signs — mirrors DANGER_SIGNS/DANGER_SIGN_LABEL in
 * apps/web/src/lib/validation/emergency.ts (adult list; the paediatric
 * variant is skipped for the same ageYears reason as above). Free text, not
 * a DB enum — trigger_detail on emergency_events is a plain text summary.
 */
export const DANGER_SIGNS = [
  "chest_pain",
  "trouble_breathing",
  "face_arm_weakness_or_slurred_speech",
  "severe_bleeding",
  "fainting_or_unresponsive",
  "seizure",
  "severe_allergic_reaction",
  "thoughts_of_self_harm",
  "sudden_severe_headache",
  "severe_abdominal_pain",
] as const;

export type DangerSign = (typeof DANGER_SIGNS)[number];

export const DANGER_SIGN_LABEL: Record<DangerSign, string> = {
  chest_pain: "Chest pain or pressure",
  trouble_breathing: "Trouble breathing",
  face_arm_weakness_or_slurred_speech: "Face/arm weakness or slurred speech",
  severe_bleeding: "Severe bleeding that won't stop",
  fainting_or_unresponsive: "Fainting or unresponsive",
  seizure: "Seizure or convulsions",
  severe_allergic_reaction: "Severe allergic reaction (swelling, throat tightness)",
  thoughts_of_self_harm: "Thoughts of harming myself",
  sudden_severe_headache: "Sudden, severe headache",
  severe_abdominal_pain: "Severe stomach pain",
};

export function dangerSignsSummary(signs: DangerSign[]): string {
  return signs.map((sign) => DANGER_SIGN_LABEL[sign]).join(", ");
}

/** Mirrors useSymptomLogs in apps/web/src/lib/queries/symptoms.ts. */
export async function loadSymptomHistory(patientId: string, limit = 20): Promise<QueryResult<SymptomLog[]>> {
  const { data, error } = await supabase
    .from("symptoms")
    .select("*")
    .eq("patient_id", patientId)
    .order("reported_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/**
 * Resolves who a write should be attributed to. Mirrors resolveSubjectId on
 * web (apps/web/src/lib/acting/acting-for.ts) and the beneficiary handling
 * in apps/web/src/app/api/mobile/vitals/route.ts: `patientId` is the
 * already-resolved subject the caller is viewing (home-shell.tsx's
 * subjectId — safe to use as-is for reads under RLS), but a write re-checks
 * `beneficiaryProfileId` (when the caller is a supporter with someone else's
 * account open) against the live 'manage' grant via the same `can_act_for`
 * RPC lib/acting.ts already uses, rather than trusting either id blindly.
 * `symptoms`/`emergency_events` both carry a `private.can_act_for(patient_id)`
 * INSERT policy (20260801110000/20260801120000), so this only ever produces
 * a friendlier error message than the raw RLS violation — the database is
 * still the actual gate either way.
 */
async function resolveWriteSubject(
  patientId: string,
  beneficiaryProfileId?: string
): Promise<{ subjectId: string } | { error: string }> {
  if (!beneficiaryProfileId || beneficiaryProfileId === patientId) {
    return { subjectId: patientId };
  }
  const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: beneficiaryProfileId });
  if (allowed !== true) {
    return { error: "You don't have permission to log this for that person." };
  }
  return { subjectId: beneficiaryProfileId };
}

async function resolveOrganisationId(subjectId: string): Promise<{ organisationId: string } | { error: string }> {
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", subjectId).single();
  if (!profile?.organisation_id) {
    return { error: "Could not find your organisation on file" };
  }
  return { organisationId: profile.organisation_id };
}

export interface LogSymptomInput {
  symptomType: AdultSymptomType;
  severity: number;
  description?: string;
}

export interface LogSymptomResult {
  success?: boolean;
  error?: string;
}

/**
 * Logs a patient-reported symptom — mirrors logSymptom in
 * apps/web/src/app/(dashboard)/patient/actions.ts. Deliberately does not
 * compute or send is_red_flag: private.handle_symptom_red_flag() (the same
 * trigger a web-logged symptom fires) derives it server-side from
 * symptom_type/severity and raises the clinician_alerts escalation, so a
 * client on either platform can't under-report a red flag by omission.
 */
export async function logSymptom(
  patientId: string,
  input: LogSymptomInput,
  beneficiaryProfileId?: string
): Promise<LogSymptomResult> {
  const subject = await resolveWriteSubject(patientId, beneficiaryProfileId);
  if ("error" in subject) return { error: subject.error };
  const org = await resolveOrganisationId(subject.subjectId);
  if ("error" in org) return { error: org.error };

  const { error } = await supabase.from("symptoms").insert({
    organisation_id: org.organisationId,
    patient_id: subject.subjectId,
    symptom_type: input.symptomType,
    severity: input.severity,
    description: input.description?.trim() || null,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export interface ReportDangerSymptomsResult {
  success?: boolean;
  error?: string;
  eventId?: string;
}

/**
 * Records a one-touch danger-symptom report as an emergency_events row —
 * mirrors reportDangerSymptoms in
 * apps/web/src/app/(dashboard)/patient/actions.ts. The DB trigger
 * (private.handle_emergency_event) raises the emergency-tier clinician_alert
 * itself; this never decides urgency, so it can't under-report. Unlike the
 * BP/glucose offline red-flag path (classifyVitalOffline in lib/vitals.ts),
 * this is not a locally-computed flag — reporting a danger sign always goes
 * straight to the server, so `synced` is always true once this resolves
 * without an error (see symptom-screen.tsx).
 */
export async function reportDangerSymptoms(
  patientId: string,
  signs: DangerSign[],
  beneficiaryProfileId?: string
): Promise<ReportDangerSymptomsResult> {
  if (signs.length === 0) return { error: "Select at least one sign" };

  const subject = await resolveWriteSubject(patientId, beneficiaryProfileId);
  if ("error" in subject) return { error: subject.error };
  const org = await resolveOrganisationId(subject.subjectId);
  if ("error" in org) return { error: org.error };

  const { data, error } = await supabase
    .from("emergency_events")
    .insert({
      organisation_id: org.organisationId,
      patient_id: subject.subjectId,
      source: "danger_symptom_checklist",
      trigger_detail: dangerSignsSummary(signs),
      status: "active",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { success: true, eventId: data.id };
}
