import { consentStateFor, type Enums } from "@tarragon/shared";
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
  consentType: Enums<"consent_type">;
  /** The consent's own title and plain-language text, shown before a person decides. */
  title: string;
  body: string;
  version: string;
  /** True only while an acceptance of THIS version is in force; a later withdrawal ends it (mirrors the database). */
  accepted: boolean;
  /** "withdrawn": the person withdrew it. "older_version": an older version is in force. */
  state: "granted" | "withdrawn" | "older_version" | "never";
  isOptional: boolean;
  acceptedAt: string | null;
}

export async function loadConsentStatus(patientId: string): Promise<QueryResult<ConsentRow[]>> {
  const [{ data: versions, error: versionsError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from("consent_versions")
      .select("consent_type, version, is_optional, title, body")
      .eq("is_current", true)
      .order("consent_type", { ascending: true }),
    supabase.from("patient_consents").select("consent_type, version, accepted_at, action, created_at").eq("patient_id", patientId),
  ]);
  if (versionsError) return { ok: false, error: versionsError.message };
  if (eventsError) return { ok: false, error: eventsError.message };

  const rows: ConsentRow[] = (versions ?? []).map((v) => {
    const state = consentStateFor(events ?? [], v);
    const record = (events ?? []).find((c) => c.consent_type === v.consent_type && c.version === v.version && c.action === "accepted");
    return {
      consentType: v.consent_type,
      title: v.title,
      body: v.body,
      version: v.version,
      accepted: state === "granted",
      state,
      isOptional: v.is_optional,
      acceptedAt: state === "granted" ? (record?.accepted_at ?? null) : null,
    };
  });
  return { ok: true, data: rows };
}

/**
 * Gives or withdraws an OPTIONAL consent for the signed-in person (S83 audit 1.4: the app could only show "Withdrawn", never do it).
 * Append-only, like the web: one more patient_consents row against the CURRENT version; the database works out which acceptance a
 * withdrawal ends. A required purpose is refused here on purpose: it is a decision about the account, handled under data rights.
 */
export async function recordConsent(
  organisationId: string,
  patientId: string,
  consentType: Enums<"consent_type">,
  action: "accepted" | "withdrawn",
): Promise<QueryResult<null>> {
  const { data: version, error: versionError } = await supabase
    .from("consent_versions")
    .select("id, version, is_optional")
    .eq("consent_type", consentType)
    .eq("is_current", true)
    .maybeSingle();
  if (versionError || !version) return { ok: false, error: "We could not find that consent." };
  if (!version.is_optional) {
    return { ok: false, error: "This one is needed to use your account. To stop it, use the data options below." };
  }
  const { error } = await supabase.from("patient_consents").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    consent_type: consentType,
    consent_version_id: version.id,
    version: version.version,
    action,
  });
  if (error) return { ok: false, error: "We could not record that just now. Please try again." };
  return { ok: true, data: null };
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
