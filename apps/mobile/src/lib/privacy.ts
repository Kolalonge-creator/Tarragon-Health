import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * "Privacy & your data" — consent status, a read-only connected-devices
 * summary, and the three data-rights request workflows (export/correction/
 * deletion). Mirrors apps/web/.../patient/privacy/{consent-status-panel,
 * connected-devices-summary,data-rights-panel}.tsx + lib/queries/
 * {consent,data-rights,wearable-connections}.ts. Every read/write here is a
 * plain RLS-scoped table call — organisation_id/patient_id/status on every
 * data-rights insert are forced server-side regardless of what's sent (see
 * the enforce_data_*_request_attribution triggers), so there's no
 * privileged path to guard client-side.
 *
 * `CareVisibilityList` (who can see my record, by category) is deliberately
 * NOT duplicated here — it already has a native home in family-screen.tsx's
 * CareVisibilityCard; this screen links out to "family" instead, same as
 * family-screen.tsx itself links out to "supporting" for its opposite
 * direction rather than re-implementing that switch mechanism.
 */
export interface ConsentRow {
  consentType: string;
  version: string;
  accepted: boolean;
  acceptedAt: string | null;
}

export async function loadConsentStatus(patientId: string): Promise<QueryResult<ConsentRow[]>> {
  const [{ data: versions, error: versionsError }, { data: accepted, error: acceptedError }] = await Promise.all([
    supabase.from("consent_versions").select("consent_type, version").eq("is_current", true).order("consent_type", { ascending: true }),
    supabase.from("patient_consents").select("consent_type, version, accepted_at").eq("patient_id", patientId),
  ]);
  if (versionsError) return { ok: false, error: versionsError.message };
  if (acceptedError) return { ok: false, error: acceptedError.message };

  const rows: ConsentRow[] = (versions ?? []).map((v) => {
    const record = (accepted ?? []).find((c) => c.consent_type === v.consent_type && c.version === v.version);
    return {
      consentType: v.consent_type,
      version: v.version,
      accepted: !!record,
      acceptedAt: record?.accepted_at ?? null,
    };
  });
  return { ok: true, data: rows };
}

export interface ConnectedDevice {
  id: string;
  provider: string;
  connectedAt: string | null;
}

/** Read-only — connecting/disconnecting a cloud wearable is a web-only
 * OAuth flow (see CLAUDE.md's Device & Wearable Integration section); this
 * just shows what's currently sharing data, same as web's own
 * ConnectedDevicesSummary. */
export async function loadConnectedDevices(patientId: string): Promise<ConnectedDevice[]> {
  const { data, error } = await supabase
    .from("wearable_connections")
    .select("id, provider, connected_at")
    .eq("patient_id", patientId)
    .in("status", ["active", "paused", "error"]);
  if (error) return [];
  return (data ?? []).map((d) => ({ id: d.id, provider: d.provider, connectedAt: d.connected_at }));
}

export interface DataRightsRequest {
  id: string;
  status: string;
  requestedAt: string;
  summary: string | null;
}

export async function loadExportRequests(): Promise<DataRightsRequest[]> {
  const { data } = await supabase.from("data_export_requests").select("id, status, requested_at, note").order("requested_at", { ascending: false });
  return (data ?? []).map((r) => ({ id: r.id, status: r.status, requestedAt: r.requested_at, summary: r.note }));
}

export async function createExportRequest(organisationId: string, patientId: string, note?: string): Promise<QueryResult<null>> {
  const { error } = await supabase.from("data_export_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    note: note || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function loadCorrectionRequests(): Promise<DataRightsRequest[]> {
  const { data } = await supabase
    .from("data_correction_requests")
    .select("id, status, requested_at, record_description")
    .order("requested_at", { ascending: false });
  return (data ?? []).map((r) => ({ id: r.id, status: r.status, requestedAt: r.requested_at, summary: r.record_description }));
}

export async function createCorrectionRequest(
  organisationId: string,
  patientId: string,
  input: { recordDescription: string; whatIsWrong: string; requestedChange?: string }
): Promise<QueryResult<null>> {
  if (!input.recordDescription.trim() || !input.whatIsWrong.trim()) {
    return { ok: false, error: "Please describe the record and what's wrong with it." };
  }
  const { error } = await supabase.from("data_correction_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    record_description: input.recordDescription,
    what_is_wrong: input.whatIsWrong,
    requested_change: input.requestedChange || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function loadDeletionRequests(): Promise<DataRightsRequest[]> {
  const { data } = await supabase.from("data_deletion_requests").select("id, status, requested_at, reason").order("requested_at", { ascending: false });
  return (data ?? []).map((r) => ({ id: r.id, status: r.status, requestedAt: r.requested_at, summary: r.reason }));
}

export async function createDeletionRequest(organisationId: string, patientId: string, reason: string): Promise<QueryResult<null>> {
  const { error } = await supabase.from("data_deletion_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    reason,
    requested_categories: [],
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
