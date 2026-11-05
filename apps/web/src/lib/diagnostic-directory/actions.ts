"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  addBranchSchema, branchToDirectorySchema, closeIncidentSchema, createFacilitySchema, credentialSchema, credentialStatusSchema,
  endPartnerSchema, noticeForError, openIncidentSchema, serviceSchema, setPartnerSchema, startListingSchema, statusSchema,
  verifyLocationSchema, type Notice,
} from "./model";

/**
 * Diagnostic directory admin actions. Each passes a parsed form to one admin_dx_* database function and turns the answer into a
 * fixed notice. The database checks who may act (admin or directory.diagnostic.verify), enforces every rule and writes the audit
 * row; nothing here decides eligibility or writes a table directly.
 */
const BASE = "/admin/ops/diagnostic-directory";
const overview = (n: Notice): never => redirect(`${BASE}?n=${n}`);
const detail = (id: string, n: Notice): never => redirect(`${BASE}/${id}?n=${n}`);
const field = (f: FormData, k: string) => (f.has(k) ? String(f.get(k)) : undefined);
const fields = (f: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(f, k)]));
const BRANCH_KEYS = ["branch_name", "state", "town", "lga", "address", "phone", "latitude", "longitude"];

async function call(fn: string, args: Record<string, unknown>) {
  return loose(await createClient()).rpc(fn, args);
}

export async function createFacilityAction(formData: FormData): Promise<void> {
  const p = createFacilitySchema.safeParse(fields(formData, ["kind", "name", ...BRANCH_KEYS]));
  if (!p.success) return overview("invalid");
  const { data, error } = await call("admin_dx_create_facility", {
    p_kind: p.data.kind, p_name: p.data.name, p_branch_name: p.data.branch_name, p_state: p.data.state, p_town: p.data.town,
    p_lga: p.data.lga ?? null, p_address: p.data.address, p_phone: p.data.phone ?? null,
    p_latitude: p.data.latitude ?? null, p_longitude: p.data.longitude ?? null, p_is_test: false,
  });
  if (error || typeof data !== "string") return overview(noticeForError(error?.code));
  return detail(data, "facility_created");
}

export async function startListingAction(formData: FormData): Promise<void> {
  const p = startListingSchema.safeParse(fields(formData, ["kind", "provider_id"]));
  if (!p.success) return overview("invalid");
  const { data, error } = await call("admin_dx_create_provider_listing", { p_kind: p.data.kind, p_provider_id: p.data.provider_id, p_is_test: false });
  if (error || typeof data !== "string") return overview(noticeForError(error?.code));
  return detail(data, "listing_started");
}

export async function addBranchAction(formData: FormData): Promise<void> {
  const p = addBranchSchema.safeParse(fields(formData, ["listing_id", ...BRANCH_KEYS]));
  if (!p.success) return overview("invalid");
  const { error } = await call("admin_dx_add_branch", {
    p_provider_listing_id: p.data.listing_id, p_branch_name: p.data.branch_name, p_state: p.data.state, p_town: p.data.town,
    p_lga: p.data.lga ?? null, p_address: p.data.address, p_phone: p.data.phone ?? null,
    p_latitude: p.data.latitude ?? null, p_longitude: p.data.longitude ?? null,
  });
  if (error) return detail(p.data.listing_id, noticeForError(error.code, true));
  return detail(p.data.listing_id, "branch_added");
}

export async function branchToDirectoryAction(formData: FormData): Promise<void> {
  const p = branchToDirectorySchema.safeParse(fields(formData, ["listing_id", "location_id", "lga", "town", "neighbourhood"]));
  if (!p.success) return overview("invalid");
  const { error } = await call("admin_dx_upsert_branch_listing", {
    p_provider_listing_id: p.data.listing_id, p_location_id: p.data.location_id, p_lga: p.data.lga ?? null, p_town: p.data.town ?? null,
    p_neighbourhood: p.data.neighbourhood ?? null, p_email: null, p_website: null, p_is_test: false,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "branch_added_to_directory");
}

export async function verifyLocationAction(formData: FormData): Promise<void> {
  const p = verifyLocationSchema.safeParse(fields(formData, ["listing_id", "branch_listing_id", "source", "note", "hours_checked"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_verify_branch_location", {
    p_branch_listing_id: p.data.branch_listing_id, p_source: p.data.source, p_note: p.data.note, p_hours_checked: p.data.hours_checked,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "location_verified");
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const p = statusSchema.safeParse(fields(formData, ["listing_id", "level", "target_id", "status", "reason"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_set_listing_status", {
    p_level: p.data.level, p_listing_id: p.data.target_id, p_status: p.data.status, p_reason: p.data.reason,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "status_set");
}

export async function saveServiceAction(formData: FormData): Promise<void> {
  const p = serviceSchema.safeParse(fields(formData, [
    "listing_id", "branch_listing_id", "concept_id", "availability", "performed", "performing_branch_listing_id",
    "appointment_required", "preparation_note", "evidence_source",
  ]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_upsert_service", {
    p_branch_listing_id: p.data.branch_listing_id, p_concept_id: p.data.concept_id, p_availability: p.data.availability,
    p_performed: p.data.performed, p_performing_branch_listing_id: p.data.performing_branch_listing_id ?? null,
    p_appointment_required: p.data.appointment_required, p_preparation_note: p.data.preparation_note ?? null,
    p_equipment_note: null, p_evidence_source: p.data.evidence_source,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "service_saved");
}

export async function recordCredentialAction(formData: FormData): Promise<void> {
  const p = credentialSchema.safeParse({
    ...fields(formData, ["listing_id", "level", "target_id", "regulator", "issuer", "accreditation_body", "state", "identifier",
      "issued_on", "expires_on", "source_url"]),
    scope_concept_ids: formData.getAll("scope_concept_ids").map(String).filter((v) => v !== ""),
  });
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_record_credential", {
    p_level: p.data.level, p_listing_id: p.data.target_id, p_regulator: p.data.regulator, p_issuer: p.data.issuer,
    p_accreditation_body: p.data.accreditation_body ?? null, p_state: p.data.state ?? null, p_identifier: p.data.identifier ?? null,
    p_scope_concept_ids: p.data.scope_concept_ids.length > 0 ? p.data.scope_concept_ids : null, p_scope_note: null,
    p_issued_on: p.data.issued_on ?? null, p_expires_on: p.data.expires_on ?? null,
    p_source_url: p.data.source_url ?? null, p_evidence_path: null,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "credential_recorded");
}

export async function setCredentialStatusAction(formData: FormData): Promise<void> {
  const p = credentialStatusSchema.safeParse(fields(formData, ["listing_id", "credential_id", "status", "note", "next_verify_due"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_set_credential_status", {
    p_credential_id: p.data.credential_id, p_status: p.data.status, p_note: p.data.note, p_next_verify_due: p.data.next_verify_due ?? null,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "credential_set");
}

export async function openIncidentAction(formData: FormData): Promise<void> {
  const p = openIncidentSchema.safeParse(fields(formData, ["listing_id", "level", "target_id", "severity", "description", "suspends"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_open_incident", {
    p_level: p.data.level, p_id: p.data.target_id, p_severity: p.data.severity, p_description: p.data.description, p_suspends: p.data.suspends,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "incident_opened");
}

export async function closeIncidentAction(formData: FormData): Promise<void> {
  const p = closeIncidentSchema.safeParse(fields(formData, ["listing_id", "incident_id", "decision", "corrective_action", "reinstate"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_close_incident", {
    p_incident_id: p.data.incident_id, p_decision: p.data.decision, p_corrective_action: p.data.corrective_action ?? null,
    p_reinstate: p.data.reinstate === "yes",
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "incident_closed");
}

/** A rejected form goes back to the provider page when its id is a real uuid, otherwise to the overview. */
function backOrOverview(formData: FormData, n: Notice): never {
  const id = String(formData.get("listing_id") ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? detail(id, n) : overview(n);
}

export async function setPartnerAction(formData: FormData): Promise<void> {
  const p = setPartnerSchema.safeParse(fields(formData, [
    "listing_id", "branch_listing_id", "starts_on", "ends_on", "has_commission", "legal_review_reference", "note"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_set_partner", {
    p_branch_listing_id: p.data.branch_listing_id, p_starts_on: p.data.starts_on, p_ends_on: p.data.ends_on ?? null,
    p_has_commission: p.data.has_commission === "yes", p_legal_review_reference: p.data.legal_review_reference ?? null, p_note: p.data.note,
  });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "partner_set");
}

export async function endPartnerAction(formData: FormData): Promise<void> {
  const p = endPartnerSchema.safeParse(fields(formData, ["listing_id", "partnership_id", "reason"]));
  if (!p.success) return backOrOverview(formData, "invalid");
  const { error } = await call("admin_dx_end_partner", { p_partnership_id: p.data.partnership_id, p_reason: p.data.reason });
  return detail(p.data.listing_id, error ? noticeForError(error.code) : "partner_ended");
}
