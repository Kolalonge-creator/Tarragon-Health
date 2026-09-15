import { supabase } from "./supabase";
import { API_BASE_URL } from "./api";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

// ---------------------------------------------------------------------------
// Verified documents — pay-per-service, no plan bypass: any of the seven
// doctor-attested document types, each priced and sold as its own credit,
// delivered as a signed PDF once issued. Mirrors apps/web/src/app/
// (dashboard)/patient/verified-documents-card.tsx. A plain insert, not a
// two-step RPC: the credit gate lives in a BEFORE INSERT trigger on
// verified_documents (20260831171012_verified_documents.sql), which raises a
// specific, catchable error when no credit exists — this file never
// pre-checks credit balance client-side, same reasoning as care-support.ts's
// ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER.
// ---------------------------------------------------------------------------

export type VerifiedDocument = Tables<"verified_documents">;
export type VerifiedDocumentType = Enums<"verified_document_type">;

/** Matches the trigger's raised text exactly: 'Buy a verified document
 * credit to request this.' (verified_documents_enforce_credit) — generic
 * across all 7 types, since the UI already knows which type was selected. */
export const VERIFIED_DOCUMENT_CREDIT_REQUIRED_MARKER = "verified document credit";

/** Every document type is its own service_products code, priced
 * individually — see private.enforce_verified_document_credit, which
 * builds the same string. */
export function serviceProductCodeFor(documentType: VerifiedDocumentType): string {
  return `verified_document_${documentType}`;
}

/** Typed off the enum, not a hand-written union, so a future document type
 * fails the build here rather than being silently unreachable — mirrors
 * verified-documents-card.tsx's own DOCUMENT_TYPE_LABEL. */
export const DOCUMENT_TYPE_LABEL: Record<VerifiedDocumentType, string> = {
  fit_to_work: "Fit-to-work letter",
  return_to_work: "Return-to-work letter",
  travel_health_certificate: "Travel health certificate",
  medication_carry_letter: "Medication carry letter",
  specialist_referral_letter: "Specialist referral letter",
  school_health_form: "School health form",
  insurance_medical_summary: "Insurance medical summary",
};

export const DOCUMENT_TYPE_OPTIONS = Object.keys(DOCUMENT_TYPE_LABEL) as VerifiedDocumentType[];

export async function loadMyVerifiedDocuments(patientId: string): Promise<QueryResult<VerifiedDocument[]>> {
  const { data, error } = await supabase
    .from("verified_documents")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as VerifiedDocument[] };
}

export async function requestVerifiedDocument(input: {
  patientId: string;
  organisationId: string;
  documentType: VerifiedDocumentType;
  requestNote?: string;
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("verified_documents").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    document_type: input.documentType,
    request_note: input.requestNote || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/**
 * The signed PDF for an issued document, opened via expo-web-browser rather
 * than fetched — a plain https URL with the caller's own short-lived
 * Supabase access token as a query param (a browser view can't be given a
 * custom Authorization header), same shape as lab-orders.ts's
 * getLabRequestPrintUrl. Safari's own in-viewer Print/Share/Save-to-Files
 * toolbar handles everything past "here it is" — no expo-print/expo-sharing
 * dependency needed.
 */
export async function getVerifiedDocumentPdfUrl(documentId: string): Promise<QueryResult<string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "Not signed in" };
  const url = `${API_BASE_URL}/api/mobile/verified-documents/${documentId}/pdf?token=${encodeURIComponent(session.access_token)}`;
  return { ok: true, data: url };
}
