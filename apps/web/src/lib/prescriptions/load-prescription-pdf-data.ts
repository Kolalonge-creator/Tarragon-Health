import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  buildPrescriptionBundle,
  buildPrescriptionPdfData,
  REFUSAL_MESSAGE,
  type PrescriptionPdfData,
  type PrescriptionPdfResult,
  type PrescriptionPrescriber,
  type PrescriptionRefusalReason,
  type PrescriptionSource,
  type SkippedPrescription,
} from "./prescription-pdf-data";

/**
 * Loads what the prescription PDF needs through the CALLER's own session, so row-level security decides who
 * can issue one: the patient, or a caregiver the medications policy admits. Staff do not read `medications`
 * directly any more (S05f), so a clinician session finds nothing here and gets "not found". That is deliberate
 * for phase 1; a clinician reprint goes through the audited read in phase 4.
 *
 * Every document that is issued writes one `audit_log` row (action `prescription.pdf_downloaded`) with the
 * caller as actor. If that write fails the download is refused: an unaudited copy of a patient's prescription
 * must not leave the system.
 */

type Client = SupabaseClient<Database>;

export const PRESCRIPTION_SELECT =
  "id, organisation_id, patient_id, source, is_active, drug_name, dose, frequency, route, quantity, duration_days, repeats_allowed, indication, instructions, rx_number, verification_code, expires_at, version, superseded_at, created_at, amendment_reason, public_token, added_by";

type MedicationRow = PrescriptionSource & { organisation_id: string; added_by: string | null };

export type PrescriptionLoadResult =
  | { status: "ok"; prescriptions: PrescriptionPdfData[]; skipped: SkippedPrescription[] }
  | { status: "not_found" }
  | { status: "refused"; reason: PrescriptionRefusalReason; message: string }
  | { status: "error"; message: string };

async function loadPatient(supabase: Client, patientId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth")
    .eq("id", patientId)
    .maybeSingle();
  return data;
}

async function loadPrescriber(supabase: Client, profileId: string | null): Promise<PrescriptionPrescriber | null> {
  if (!profileId) return null;
  const [{ data: staff }, { data: profile }] = await Promise.all([
    supabase
      .from("clinical_staff_directory")
      .select("credential_type, credential_number, license_verified")
      .eq("profile_id", profileId)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", profileId).maybeSingle(),
  ]);
  if (!staff) return null;
  return {
    name: profile?.full_name ?? null,
    credentialType: staff.credential_type,
    credentialNumber: staff.credential_number,
    licenseVerified: staff.license_verified === true,
  };
}

async function recordDownloads(
  supabase: Client,
  actorId: string,
  rows: { organisationId: string; patientId: string; medicationId: string; rxNumber: string; version: number }[],
  channel: "web" | "mobile",
  bundle: boolean,
): Promise<string | null> {
  const { error } = await supabase.from("audit_log").insert(
    rows.map((row) => ({
      organisation_id: row.organisationId,
      actor_id: actorId,
      action: "prescription.pdf_downloaded",
      entity_type: "medications",
      entity_id: row.medicationId,
      subject_patient_id: row.patientId,
      result: "success",
      event: { rx_number: row.rxNumber, version: row.version, channel, bundle },
    })),
  );
  return error ? error.message : null;
}

export async function loadSinglePrescription(
  supabase: Client,
  actorId: string,
  medicationId: string,
  channel: "web" | "mobile",
): Promise<PrescriptionLoadResult> {
  const { data, error } = await supabase
    .from("medications")
    .select(PRESCRIPTION_SELECT)
    .eq("id", medicationId)
    .maybeSingle();
  if (error) return { status: "error", message: error.message };
  const medication = data as MedicationRow | null;
  if (!medication) return { status: "not_found" };

  const [patient, prescriber] = await Promise.all([
    loadPatient(supabase, medication.patient_id),
    loadPrescriber(supabase, medication.added_by),
  ]);
  if (!patient) return { status: "not_found" };

  const built = buildPrescriptionPdfData({ medication, patient, prescriber });
  if (built.status === "refused") return { status: "refused", reason: built.reason, message: built.message };

  const auditError = await recordDownloads(
    supabase,
    actorId,
    [{ organisationId: medication.organisation_id, patientId: medication.patient_id, medicationId: medication.id, rxNumber: built.data.rxNumber, version: built.data.version }],
    channel,
    false,
  );
  if (auditError) return { status: "error", message: "Could not record this download, so the document was not issued." };
  return { status: "ok", prescriptions: [built.data], skipped: [] };
}

/** Every current clinician prescription for one patient, one page each. Rows that fail an issuing rule are skipped and reported. */
export async function loadPrescriptionBundle(
  supabase: Client,
  actorId: string,
  patientId: string,
  channel: "web" | "mobile",
): Promise<PrescriptionLoadResult> {
  const { data, error } = await supabase
    .from("medications")
    .select(PRESCRIPTION_SELECT)
    .eq("patient_id", patientId)
    .eq("source", "clinician")
    .eq("is_active", true)
    .is("superseded_at", null)
    .order("created_at", { ascending: true });
  if (error) return { status: "error", message: error.message };
  const rows = (data ?? []) as MedicationRow[];
  if (rows.length === 0) return { status: "not_found" };

  const patient = await loadPatient(supabase, patientId);
  if (!patient) return { status: "not_found" };

  const prescribers = new Map<string, PrescriptionPrescriber | null>();
  const results: PrescriptionPdfResult[] = [];
  const names: string[] = [];
  for (const row of rows) {
    names.push(row.drug_name);
    const key = row.added_by ?? "";
    if (!prescribers.has(key)) prescribers.set(key, await loadPrescriber(supabase, row.added_by));
    results.push(buildPrescriptionPdfData({ medication: row, patient, prescriber: prescribers.get(key) ?? null }));
  }

  const { included, refused } = buildPrescriptionBundle(results);
  const skipped: SkippedPrescription[] = [];
  results.forEach((result, index) => {
    if (result.status === "refused") {
      skipped.push({ drugName: names[index] ?? "Medicine", reason: result.reason, message: result.message });
    }
  });
  if (included.length === 0) {
    const reason = refused[0]?.reason ?? "missing_identifiers";
    return { status: "refused", reason, message: REFUSAL_MESSAGE[reason] };
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const auditError = await recordDownloads(
    supabase,
    actorId,
    included.map((rx) => {
      const row = byId.get(rx.medicationId)!;
      return { organisationId: row.organisation_id, patientId: row.patient_id, medicationId: rx.medicationId, rxNumber: rx.rxNumber, version: rx.version };
    }),
    channel,
    true,
  );
  if (auditError) return { status: "error", message: "Could not record this download, so the document was not issued." };
  return {
    status: "ok",
    prescriptions: included,
    skipped,
  };
}
