import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

/**
 * Shared result shape for the native read-path lib functions (overview.ts
 * imports it from here). A failed clinical query must be distinguishable
 * from a genuinely empty one — destructuring `{ data }` and discarding the
 * error made an RLS denial or a network drop render as "Active meds 0" /
 * "No scheduled doses today", which is a false clinical claim, not a UI nit.
 */
export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type DoseStatus = "pending" | "taken" | "missed" | "skipped";

export interface DoseChecklistItem {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
}

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
// Sourced from medication_logs_latest_per_slot (20260830224528), not the raw
// append-only table — a view's columns are nullable regardless of the
// underlying column, hence the broader types here versus medication_logs'.
type LogForChecklist = Pick<
  Tables<"medication_logs_latest_per_slot">,
  "medication_id" | "scheduled_time" | "status"
>;

/** Mirrors apps/web/src/lib/medication-schedule/checklist.ts's buildTodaysDoseChecklist —
 * duplicated rather than imported since apps/web isn't a shared package the
 * mobile app can pull from; keep the two in sync if the scheduling rule changes. */
export function buildTodaysDoseChecklist(
  medications: MedicationForChecklist[],
  logs: LogForChecklist[]
): DoseChecklistItem[] {
  const items: DoseChecklistItem[] = [];
  for (const medication of medications) {
    const times = Array.isArray(medication.schedule_times)
      ? (medication.schedule_times as string[])
      : [];
    for (const time of times) {
      const log = logs.find((l) => l.medication_id === medication.id && l.scheduled_time === time);
      items.push({
        medicationId: medication.id,
        drugName: medication.drug_name,
        time,
        status: (log?.status as DoseStatus | undefined) ?? "pending",
      });
    }
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

/** Patient-local (Africa/Lagos) calendar date, per CLAUDE.md's fixed timezone rule. */
export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * medication_logs is append-only (20260830224528): a slot can carry more
 * than one row once a dose is corrected. medication_logs_latest_per_slot
 * keeps only the latest row per (medication, date, time) — freeform/
 * as-needed logs (no scheduled slot) are never deduped, each stands alone.
 */
export async function loadTodaysDoses(patientId: string): Promise<QueryResult<DoseChecklistItem[]>> {
  const today = todayIsoDate();
  try {
    const [medsRes, logsRes] = await Promise.all([
      supabase
        .from("medications")
        .select("id, drug_name, schedule_times")
        .eq("patient_id", patientId)
        .eq("is_active", true),
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_time, status")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today),
    ]);
    const failure = medsRes.error ?? logsRes.error;
    if (failure) return { ok: false, error: failure.message };
    return { ok: true, data: buildTodaysDoseChecklist(medsRes.data ?? [], logsRes.data ?? []) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Append-only (20260830224528): every dose action is a new row, never an
 * update of a previous one — mirrors useLogDose in
 * apps/web/src/lib/queries/medications.ts exactly (a bare client insert is
 * safe here: the adherence-streak/alert side effect is a DB trigger on
 * medication_logs, not app code, so it fires the same way regardless of
 * which client wrote the row).
 */
export async function logDose(
  patientId: string,
  organisationId: string,
  item: DoseChecklistItem,
  status: Exclude<DoseStatus, "pending">
): Promise<{ error?: string }> {
  const scheduled_for_date = todayIsoDate();
  const { error } = await supabase.from("medication_logs").insert({
    medication_id: item.medicationId,
    scheduled_time: item.time,
    scheduled_for_date,
    status,
    patient_id: patientId,
    organisation_id: organisationId,
  });
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Medicines cabinet — backs medicine-cabinet-screen.tsx, the native replacement
// for the old WebViewScreen("/patient/medications") modal. Mirrors the read/
// write shapes of apps/web/src/lib/queries/medications.ts and its sibling
// query files (adherence-checkins, lab-monitoring, medication-repeat-requests)
// — duplicated rather than imported since apps/web isn't a shared package the
// mobile app can pull from (same reasoning as buildTodaysDoseChecklist above).
// ---------------------------------------------------------------------------

type MedicationSource = Tables<"medications">["source"];

export type MedicationCabinetItem = Pick<
  Tables<"medications">,
  | "id"
  | "drug_name"
  | "dose"
  | "frequency"
  | "schedule_times"
  | "source"
  | "prescriber_name"
  | "prescriber_document_url"
  | "refill_date"
  | "last_confirmed_at"
  | "expires_at"
  | "repeats_allowed"
  | "organisation_id"
  | "created_at"
> & { care_plan_condition: string | null };

const MEDICATION_CABINET_SELECT =
  "id, drug_name, dose, frequency, schedule_times, source, prescriber_name, prescriber_document_url, refill_date, last_confirmed_at, expires_at, repeats_allowed, organisation_id, created_at, care_plan:care_plans(condition)";

type MedicationCabinetRow = Omit<MedicationCabinetItem, "care_plan_condition"> & {
  care_plan: { condition: string } | { condition: string }[] | null;
};

function normaliseCabinetRow(row: MedicationCabinetRow): MedicationCabinetItem {
  const { care_plan, ...rest } = row;
  const condition = Array.isArray(care_plan) ? (care_plan[0]?.condition ?? null) : (care_plan?.condition ?? null);
  return { ...rest, care_plan_condition: condition };
}

/** Active medications, newest first — mirrors useMedications' ordering. */
export async function loadMedicationCabinet(patientId: string): Promise<QueryResult<MedicationCabinetItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medications")
      .select(MEDICATION_CABINET_SELECT)
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? []).map((row) => normaliseCabinetRow(row as unknown as MedicationCabinetRow)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface AddMedicationInput {
  drugName: string;
  dose?: string;
  frequency?: string;
  refillDate?: string;
  scheduleTimes: string[];
  startedBySpecialist: boolean;
  prescriberName?: string;
  prescriberDocumentUrl?: string;
}

/**
 * Patient self-add, mirrors useAddMedication's patient-source branch exactly
 * (organisation_id resolved server-round-trip from the patient's own profile,
 * never trusted from the client). The clinician-prescribe path (draft/review/
 * sign, safety notes, controlled-substance ack) is web-only — a patient's own
 * cabinet never reaches that flow on either platform.
 */
export async function addMedication(patientId: string, input: AddMedicationInput): Promise<{ error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .single();
  if (profileError) return { error: profileError.message };
  if (!profile?.organisation_id) return { error: "This patient has no organisation on file" };

  const source: MedicationSource = input.startedBySpecialist ? "specialist" : "patient";
  const { error } = await supabase.from("medications").insert({
    drug_name: input.drugName,
    dose: input.dose || null,
    frequency: input.frequency || null,
    refill_date: input.refillDate || null,
    schedule_times: input.scheduleTimes,
    patient_id: patientId,
    organisation_id: profile.organisation_id,
    source,
    prescriber_name: source === "specialist" ? input.prescriberName || null : null,
    prescriber_document_url: source === "specialist" ? input.prescriberDocumentUrl || null : null,
  });
  return error ? { error: error.message } : {};
}

// --- Adherence check-ins ----------------------------------------------------

export type AdherenceCheckinItem = Pick<
  Tables<"medication_adherence_checkins">,
  "id" | "checkin_type" | "due_date" | "status" | "response" | "medication_id"
> & { drug_name: string | null };

type AdherenceCheckinRow = Omit<AdherenceCheckinItem, "drug_name"> & {
  medication: { drug_name: string } | { drug_name: string }[] | null;
};

/** Mirrors checkinQuestion in apps/web/src/lib/queries/adherence-checkins.ts. */
export function checkinQuestion(type: string, drugName: string | null): string {
  const drug = drugName ?? "your medication";
  switch (type) {
    case "started":
      return `Have you started taking ${drug}?`;
    case "side_effects":
      return `Any side effects from ${drug}?`;
    case "missed_doses":
      return `How many doses of ${drug} have you missed recently?`;
    case "lab_review":
      return `It's time for a follow-up review of ${drug}. Anything you'd like your care team to know?`;
    default:
      return `A quick check-in about ${drug}.`;
  }
}

/** Pending check-ins due on/before today, soonest first. */
export async function loadDueCheckins(patientId: string): Promise<QueryResult<AdherenceCheckinItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_adherence_checkins")
      .select(
        "id, checkin_type, due_date, status, response, medication_id, medication:medications!medication_adherence_checkins_medication_id_fkey(drug_name)"
      )
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", todayIsoDate())
      .order("due_date", { ascending: true });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as AdherenceCheckinRow[];
    return {
      ok: true,
      data: rows.map(({ medication, ...rest }) => ({
        ...rest,
        drug_name: Array.isArray(medication) ? (medication[0]?.drug_name ?? null) : (medication?.drug_name ?? null),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function respondToCheckin(checkinId: string, response: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("medication_adherence_checkins")
    .update({ status: "responded", response, responded_at: new Date().toISOString() })
    .eq("id", checkinId);
  return error ? { error: error.message } : {};
}

// --- Lab monitoring due ------------------------------------------------------

export type LabMonitoringItem = Pick<
  Tables<"medication_lab_monitoring">,
  "id" | "monitoring_label" | "due_date" | "drug_class" | "medication_id"
> & { drug_name: string | null };

type LabMonitoringRow = Omit<LabMonitoringItem, "drug_name"> & {
  medication: { drug_name: string } | { drug_name: string }[] | null;
};

/** Pending drug-triggered lab monitoring — mirrors usePatientLabMonitoring. */
export async function loadLabMonitoring(patientId: string): Promise<QueryResult<LabMonitoringItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_lab_monitoring")
      .select(
        "id, monitoring_label, due_date, drug_class, medication_id, medication:medications!medication_lab_monitoring_medication_id_fkey(drug_name)"
      )
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as LabMonitoringRow[];
    return {
      ok: true,
      data: rows.map(({ medication, ...rest }) => ({
        ...rest,
        drug_name: Array.isArray(medication) ? (medication[0]?.drug_name ?? null) : (medication?.drug_name ?? null),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Refill: "next supply" requests + pharmacy collection status -----------
//
// Tarragon dropped pharmacy routing entirely 2026-08-03 (self-arranged
// fulfilment) — there is no "sent to pharmacy" step and no live order to
// track. "Pharmacy order status" here means exactly what the web cabinet
// shows: the patient's own collection record (pharmacy_order_dispenses,
// "I picked this up") plus the clinical review status of a repeat request
// (medication_repeat_requests) — never a fabricated delivery/logistics state.

export type RepeatRequestItem = Pick<
  Tables<"medication_repeat_requests">,
  "id" | "medication_id" | "status" | "requested_at" | "reviewed_at" | "denial_reason"
>;

export async function loadRepeatRequests(patientId: string): Promise<QueryResult<RepeatRequestItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_repeat_requests")
      .select("id, medication_id, status, requested_at, reviewed_at, denial_reason")
      .eq("patient_id", patientId)
      .order("requested_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "I need my next supply" — every request needs clinical review, no
 * auto-approve path (20260829011000_medication_repeat_requests.sql). */
export async function requestMedicationRepeat(patientId: string, medicationId: string): Promise<{ error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .single();
  if (profileError) return { error: profileError.message };
  if (!profile?.organisation_id) return { error: "This patient has no organisation on file" };

  const { error } = await supabase.from("medication_repeat_requests").insert({
    medication_id: medicationId,
    patient_id: patientId,
    organisation_id: profile.organisation_id,
  });
  return error ? { error: error.message } : {};
}

export type MedicationCollectionItem = Pick<
  Tables<"pharmacy_order_dispenses">,
  "id" | "medication_id" | "dispensed_on" | "pharmacy_name"
>;

/** All of the patient's own collection records that reference a medication —
 * mirrors useMedicationCollections; callers pick the latest per medication. */
export async function loadMedicationCollections(patientId: string): Promise<QueryResult<MedicationCollectionItem[]>> {
  try {
    const { data, error } = await supabase
      .from("pharmacy_order_dispenses")
      .select("id, medication_id, dispensed_on, pharmacy_name")
      .eq("patient_id", patientId)
      .not("medication_id", "is", null)
      .order("dispensed_on", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "I picked this up" — mirrors MedicationCollectionForm exactly: writes
 * straight through the patient's own session, pharmacy_order_id stays null. */
export async function logMedicationCollection(
  patientId: string,
  organisationId: string,
  medicationId: string,
  drugName: string,
  collectedOn: string,
  pharmacyName: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from("pharmacy_order_dispenses").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    medication_id: medicationId,
    drug_name: drugName,
    dispensed_on: collectedOn,
    pharmacy_name: pharmacyName.trim() || null,
    source: "patient",
  });
  return error ? { error: error.message } : {};
}

// --- Check my pack -----------------------------------------------------------
//
// Pure comparison logic ported verbatim from apps/web/src/lib/medications/
// pack-check.ts (same "duplicated, not imported" reasoning as elsewhere in
// this file). The web version's OCR read of the pack photo runs through a
// governed AI system (AI-007, ai-governance) invoked from a Next.js Server
// Action that calls Anthropic directly — there is no public API route for
// it, so it cannot be reached from the mobile app without registering a new
// AI call site, which is out of scope here. The native flow instead has the
// patient type what the pack actually says (still photographing it for their
// own reference) and runs the identical, deterministic comparison against
// their active medications — same verdicts, same NAFDAC-authenticity framing,
// just a typed reading in place of an OCR'd one.

export interface ParsedStrength {
  value: number;
  unit: string;
}

export function parseStrength(text: string | null | undefined): ParsedStrength | null {
  if (!text) return null;
  const match = text
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|%)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  let unit = match[2];
  if (unit === "µg" || unit === "ug") unit = "mcg";
  return { value, unit };
}

function toBase(strength: ParsedStrength): { value: number; family: string } | null {
  switch (strength.unit) {
    case "mcg":
      return { value: strength.value / 1000, family: "mass" };
    case "mg":
      return { value: strength.value, family: "mass" };
    case "g":
      return { value: strength.value * 1000, family: "mass" };
    case "ml":
      return { value: strength.value, family: "volume" };
    case "iu":
      return { value: strength.value, family: "iu" };
    case "%":
      return { value: strength.value, family: "percent" };
    default:
      return null;
  }
}

export function strengthsMatch(a: ParsedStrength | null, b: ParsedStrength | null): boolean {
  if (!a || !b) return false;
  const ba = toBase(a);
  const bb = toBase(b);
  if (!ba || !bb || ba.family !== bb.family) return false;
  return Math.abs(ba.value - bb.value) < 1e-6;
}

export function drugNamesMatch(packName: string, prescribedName: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(tablets?|caps?|capsules?|syrup|suspension|injection|mr|sr|xl|er|od|bd|tds)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(packName);
  const b = norm(prescribedName);
  if (!a || !b) return false;
  if (a === b) return true;
  const aTokens = a.split(" ").filter((t) => t.length > 3);
  const bTokens = b.split(" ").filter((t) => t.length > 3);
  return aTokens.some((t) => bTokens.includes(t) || b.includes(t)) || bTokens.some((t) => a.includes(t));
}

export type PackCheckVerdict =
  | "matches_prescription"
  | "strength_differs"
  | "strength_unknown"
  | "not_on_your_list"
  | "unreadable";

export interface PackCheckResult {
  verdict: PackCheckVerdict;
  matchedDrugName: string | null;
  packStrength: ParsedStrength | null;
  prescribedStrength: ParsedStrength | null;
}

export interface PrescribedMedication {
  drugName: string;
  dose: string | null;
}

export function checkPackAgainstPrescription(
  pack: { drugName: string; strength: string | null },
  prescribed: PrescribedMedication[]
): PackCheckResult {
  const packStrength = parseStrength(pack.strength);
  const match = prescribed.find((m) => drugNamesMatch(pack.drugName, m.drugName));

  if (!match) {
    return { verdict: "not_on_your_list", matchedDrugName: null, packStrength, prescribedStrength: null };
  }

  const prescribedStrength = parseStrength(match.dose);
  if (!packStrength || !prescribedStrength) {
    return {
      verdict: "strength_unknown",
      matchedDrugName: match.drugName,
      packStrength,
      prescribedStrength,
    };
  }

  return {
    verdict: strengthsMatch(packStrength, prescribedStrength) ? "matches_prescription" : "strength_differs",
    matchedDrugName: match.drugName,
    packStrength,
    prescribedStrength,
  };
}

/** NAFDAC's Mobile Authentication Service — the only authenticity check this
 * feature ever points at, verbatim from apps/web's pack-check.ts. */
export const NAFDAC_MAS = {
  shortcode: "38353",
  howTo:
    "If the pack has a scratch panel, scratch it, then text the code it hides to 38353. NAFDAC will reply for free saying whether that code is genuine.",
  caveat:
    "Not every genuine medicine carries a scratch panel, so no panel does not mean a fake. If anything about a pack worries you, take it back to the pharmacy you bought it from and tell your care team.",
} as const;
