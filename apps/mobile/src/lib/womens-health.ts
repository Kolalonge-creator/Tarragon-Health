import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums, Tables } from "@tarragon/shared";

/**
 * Women's Health (spec §44) — life-stage cards: reproductive-health profile
 * + contraception, antenatal + pregnancy red-flag checklist, postnatal,
 * breast-symptom reporting, menopause symptom tracking, fertility requests.
 * Mirrors apps/web/.../patient/womens-health-actions.ts +
 * lib/queries/{reproductive-health,womens-health}.ts. Every read/write here
 * is a plain RLS-scoped call — no service-role client, no new access-control
 * shape. **Read docs/mobile-native-conversion/womens-health.md's
 * "Reproductive-health safety notes" before changing anything in this
 * file** — reproductive_health_profiles/menstrual_cycles/
 * menstrual_daily_logs have a real, three-times-repeated history of a new
 * caller copying a pre-category-model RLS shape. This file writes no RLS —
 * it only calls the existing, already-audited tables scoped by whatever
 * `patientId` the caller passes (home-shell's already-resolved subjectId),
 * exactly like weight-management.ts does.
 *
 * Unlike womens-health-actions.ts, every write below takes `patientId`
 * explicitly and uses it — never a hardcoded device-owner id — including
 * setLastMenstrualPeriod/recordDelivery/logPostnatalCheckin, which on web
 * incorrectly use user.id directly instead of resolveSubjectId(user.id) (a
 * documented pre-existing bug, see the safety notes). Don't replicate that.
 */

export type ReproductiveLifeStage = Enums<"reproductive_life_stage">;
export type ReproductiveHealthProfile = Tables<"reproductive_health_profiles">;
export type AntenatalVisit = Tables<"antenatal_visits">;
export type PatientPregnancy = Tables<"patient_pregnancy">;
export type PostnatalProfile = Tables<"postnatal_profiles">;
export type PostnatalCheckin = Tables<"postnatal_checkins">;
export type BreastSymptomReport = Tables<"breast_symptom_reports">;
export type MenopauseSymptomLog = Tables<"menopause_symptom_logs">;
export type FertilityAssessmentRequest = Tables<"fertility_assessment_requests">;

// ---------------------------------------------------------------------------
// Reproductive-health profile + contraception (§44.2/44.5)
// ---------------------------------------------------------------------------

export async function loadReproductiveHealthProfile(patientId: string): Promise<ReproductiveHealthProfile | null> {
  const { data } = await supabase
    .from("reproductive_health_profiles")
    .select("*")
    .eq("patient_id", patientId)
    .maybeSingle();
  return data ?? null;
}

/** Upserts the caller's own row (one per patient, unique on patient_id). */
export async function saveReproductiveHealthProfile(
  patientId: string,
  organisationId: string,
  input: { life_stage: ReproductiveLifeStage; last_period_date: string | null; average_cycle_length_days: number | null }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("reproductive_health_profiles").upsert(
    {
      patient_id: patientId,
      organisation_id: organisationId,
      life_stage: input.life_stage,
      last_period_date: input.last_period_date,
      average_cycle_length_days: input.average_cycle_length_days,
    },
    { onConflict: "patient_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Only touches current_contraception_method — leaves life_stage etc. on
 * the existing row alone, mirroring saveContraceptionMethod's upsert. */
export async function saveContraceptionMethod(
  patientId: string,
  organisationId: string,
  method: string | null
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("reproductive_health_profiles").upsert(
    { patient_id: patientId, organisation_id: organisationId, current_contraception_method: method?.trim() || null },
    { onConflict: "patient_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Pregnancy / antenatal (§44.6/44.7)
// ---------------------------------------------------------------------------

export async function loadPregnancy(patientId: string): Promise<QueryResult<PatientPregnancy | null>> {
  const { data, error } = await supabase
    .from("patient_pregnancy")
    .select("is_pregnant, estimated_due_date, last_menstrual_period_date, high_risk")
    .eq("patient_id", patientId)
    .maybeSingle();
  // A read that errored is NOT "not pregnant" — same discipline as
  // page.tsx's own comment. Callers must not collapse this into null.
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as PatientPregnancy | null) ?? null };
}

export async function setLastMenstrualPeriod(
  patientId: string,
  organisationId: string,
  lastMenstrualPeriodDate: string
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("patient_pregnancy").upsert(
    { patient_id: patientId, organisation_id: organisationId, is_pregnant: true, last_menstrual_period_date: lastMenstrualPeriodDate },
    { onConflict: "patient_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function loadAntenatalVisits(patientId: string): Promise<AntenatalVisit[]> {
  const { data } = await supabase
    .from("antenatal_visits")
    .select("*")
    .eq("patient_id", patientId)
    .order("gestational_week_at_visit", { ascending: true, nullsFirst: false });
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Pregnancy red-flag safety pathway (§44.8) — a dedicated checklist
// alongside the general one-touch emergency check, only shown while
// pregnant. Reports the same way web does: a plain emergency_events insert
// (source 'pregnancy_symptom_checklist'); the existing
// handle_emergency_event trigger does all classification server-side.
// ---------------------------------------------------------------------------

export const PREGNANCY_DANGER_SIGNS = [
  "vaginal_bleeding",
  "severe_headache_with_vision_changes",
  "reduced_or_no_baby_movement",
  "severe_abdominal_pain",
  "fever_or_chills",
  "swelling_of_face_hands_with_headache",
  "waters_broken",
  "severe_vomiting",
] as const;
export type PregnancyDangerSign = (typeof PREGNANCY_DANGER_SIGNS)[number];

export const PREGNANCY_DANGER_SIGN_LABEL: Record<PregnancyDangerSign, string> = {
  vaginal_bleeding: "Vaginal bleeding",
  severe_headache_with_vision_changes: "Severe headache with blurred/flashing vision",
  reduced_or_no_baby_movement: "Reduced or no baby movement",
  severe_abdominal_pain: "Severe abdominal pain",
  fever_or_chills: "Fever or chills",
  swelling_of_face_hands_with_headache: "Sudden swelling of face/hands with headache",
  waters_broken: "Waters broken",
  severe_vomiting: "Severe, persistent vomiting",
};

function pregnancyDangerSignsSummary(signs: PregnancyDangerSign[]): string {
  return `Pregnancy warning sign(s): ${signs.map((sign) => PREGNANCY_DANGER_SIGN_LABEL[sign]).join(", ")}`;
}

/** Plain RLS-scoped insert into emergency_events, same mechanism web's
 * reportPregnancyDangerSymptoms uses directly — no service role, no
 * app-layer classification. Returns ok:true once the row is confirmed
 * written, so the caller knows the server side has genuinely seen it
 * (unlike the offline vitals queue, this has no local queue of its own). */
export async function reportPregnancyDangerSigns(
  patientId: string,
  organisationId: string,
  signs: PregnancyDangerSign[]
): Promise<QueryResult<null>> {
  if (signs.length === 0) return { ok: false, error: "Select at least one sign" };
  const { error } = await supabase.from("emergency_events").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    source: "pregnancy_symptom_checklist",
    trigger_detail: pregnancyDangerSignsSummary(signs),
    status: "active",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Postnatal (§44.9)
// ---------------------------------------------------------------------------

export const CHECKIN_WINDOWS = ["week_1", "week_6", "month_3", "month_6", "month_12", "other"] as const;
export type CheckinWindow = (typeof CHECKIN_WINDOWS)[number];
export const CHECKIN_LABEL: Record<CheckinWindow, string> = {
  week_1: "Week 1",
  week_6: "Week 6",
  month_3: "Month 3",
  month_6: "Month 6",
  month_12: "Month 12",
  other: "Other",
};

export const BREASTFEEDING_STATUSES = ["not_started", "exclusive", "mixed", "formula_only", "stopped"] as const;
export type BreastfeedingStatus = (typeof BREASTFEEDING_STATUSES)[number];
export const BREASTFEEDING_LABEL: Record<BreastfeedingStatus, string> = {
  not_started: "Not started",
  exclusive: "Exclusive breastfeeding",
  mixed: "Mixed feeding",
  formula_only: "Formula only",
  stopped: "Stopped",
};

export async function loadPostnatalProfiles(patientId: string): Promise<PostnatalProfile[]> {
  const { data } = await supabase
    .from("postnatal_profiles")
    .select("*")
    .eq("patient_id", patientId)
    .order("delivery_date", { ascending: false });
  return data ?? [];
}

/** "I delivered" transition: flips patient_pregnancy.is_pregnant off and
 * opens a new postnatal_profiles row. */
export async function recordDelivery(
  patientId: string,
  organisationId: string,
  input: { delivery_date: string; delivery_mode: "vaginal" | "assisted" | "caesarean" | "unknown"; complications?: string }
): Promise<QueryResult<null>> {
  const { error: pregnancyError } = await supabase
    .from("patient_pregnancy")
    .upsert({ patient_id: patientId, organisation_id: organisationId, is_pregnant: false }, { onConflict: "patient_id" });
  if (pregnancyError) return { ok: false, error: pregnancyError.message };

  const { error } = await supabase.from("postnatal_profiles").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    delivery_date: input.delivery_date,
    delivery_mode: input.delivery_mode,
    complications: input.complications,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function loadPostnatalCheckins(postnatalProfileId: string): Promise<PostnatalCheckin[]> {
  const { data } = await supabase
    .from("postnatal_checkins")
    .select("*")
    .eq("postnatal_profile_id", postnatalProfileId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function logPostnatalCheckin(
  patientId: string,
  organisationId: string,
  postnatalProfileId: string,
  input: {
    checkin_window: CheckinWindow;
    breastfeeding_status?: BreastfeedingStatus;
    maternal_recovery_notes?: string;
    contraception_discussed: boolean;
  }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("postnatal_checkins").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    postnatal_profile_id: postnatalProfileId,
    checkin_window: input.checkin_window,
    breastfeeding_status: input.breastfeeding_status,
    maternal_recovery_notes: input.maternal_recovery_notes,
    contraception_discussed: input.contraception_discussed,
    completed_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Breast health (§44.11) — submitting raises a clinical clinician_review
// alert server-side (private.handle_breast_symptom_report trigger); this
// module never decides urgency itself.
// ---------------------------------------------------------------------------

export const BREAST_SYMPTOM_TYPES = ["lump", "pain", "nipple_discharge", "skin_change", "nipple_change", "swelling", "other"] as const;
export type BreastSymptomType = (typeof BREAST_SYMPTOM_TYPES)[number];
export const BREAST_SYMPTOM_LABEL: Record<BreastSymptomType, string> = {
  lump: "A lump or thickening",
  pain: "Pain",
  nipple_discharge: "Nipple discharge",
  skin_change: "Skin change (dimpling, redness)",
  nipple_change: "Nipple change (inversion, shape)",
  swelling: "Swelling",
  other: "Other",
};

export async function loadBreastSymptomReports(patientId: string): Promise<BreastSymptomReport[]> {
  const { data } = await supabase
    .from("breast_symptom_reports")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function reportBreastSymptoms(
  patientId: string,
  organisationId: string,
  input: {
    symptom_types: BreastSymptomType[];
    laterality?: "left" | "right" | "both" | "unsure";
    duration_note?: string;
    notes?: string;
  }
): Promise<QueryResult<null>> {
  if (input.symptom_types.length === 0) return { ok: false, error: "Select at least one symptom" };
  const { error } = await supabase.from("breast_symptom_reports").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    symptom_types: input.symptom_types,
    laterality: input.laterality,
    duration_note: input.duration_note,
    notes: input.notes,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Menopause (§44.12) — postmenopausal_bleeding=true always raises a
// clinical clinician_review alert server-side
// (private.handle_menopause_symptom_log trigger).
// ---------------------------------------------------------------------------

export const MENOPAUSE_SYMPTOM_TYPES = [
  "hot_flashes",
  "night_sweats",
  "sleep_disturbance",
  "mood_changes",
  "vaginal_dryness",
  "joint_aches",
  "brain_fog",
  "other",
] as const;
export type MenopauseSymptomType = (typeof MENOPAUSE_SYMPTOM_TYPES)[number];
export const MENOPAUSE_SYMPTOM_LABEL: Record<MenopauseSymptomType, string> = {
  hot_flashes: "Hot flashes",
  night_sweats: "Night sweats",
  sleep_disturbance: "Sleep disturbance",
  mood_changes: "Mood changes",
  vaginal_dryness: "Vaginal dryness",
  joint_aches: "Joint aches",
  brain_fog: "Brain fog / concentration",
  other: "Other",
};

export async function loadMenopauseSymptomLogs(patientId: string): Promise<MenopauseSymptomLog[]> {
  const { data } = await supabase
    .from("menopause_symptom_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("logged_at", { ascending: false })
    .limit(12);
  return data ?? [];
}

export async function logMenopauseSymptoms(
  patientId: string,
  organisationId: string,
  input: { symptom_types: MenopauseSymptomType[]; severity?: number; postmenopausal_bleeding: boolean; notes?: string }
): Promise<QueryResult<null>> {
  if (input.symptom_types.length === 0 && !input.postmenopausal_bleeding) {
    return { ok: false, error: "Select at least one symptom, or report bleeding" };
  }
  const { error } = await supabase.from("menopause_symptom_logs").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    symptom_types: input.symptom_types,
    severity: input.severity,
    postmenopausal_bleeding: input.postmenopausal_bleeding,
    notes: input.notes,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Fertility (§44.13) — the patient logs a request; status is progressed
// staff-only, never presented as a prediction or a guarantee.
// ---------------------------------------------------------------------------

const FERTILITY_STATUS_LABEL: Record<string, string> = {
  requested: "Request received",
  education_provided: "Education shared",
  consult_booked: "Consultation booked",
  referred: "Referred to a specialist",
  closed: "Closed",
};

export function fertilityStatusLabel(status: string): string {
  return FERTILITY_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export async function loadFertilityAssessmentRequests(patientId: string): Promise<FertilityAssessmentRequest[]> {
  const { data } = await supabase
    .from("fertility_assessment_requests")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function requestFertilityAssessment(
  patientId: string,
  organisationId: string,
  input: { trying_duration_months?: number; concern_notes?: string }
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("fertility_assessment_requests").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    trying_duration_months: input.trying_duration_months,
    concern_notes: input.concern_notes,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Emergency-contact context for the pregnancy red-flag guidance modal —
// only what EmergencyGuidanceModal needs, not the full loadEmergencyFacts
// read (allergies/conditions aren't relevant here).
// ---------------------------------------------------------------------------

export interface PregnancyEmergencyContext {
  state: string | null;
  emergencyContact: { name: string; phone: string | null; relationship: string | null } | null;
}

export async function loadPregnancyEmergencyContext(patientId: string): Promise<PregnancyEmergencyContext> {
  const { data } = await supabase
    .from("profiles")
    .select("state, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
    .eq("id", patientId)
    .maybeSingle();
  return {
    state: data?.state ?? null,
    emergencyContact: data?.emergency_contact_name
      ? { name: data.emergency_contact_name, phone: data.emergency_contact_phone, relationship: data.emergency_contact_relationship }
      : null,
  };
}
