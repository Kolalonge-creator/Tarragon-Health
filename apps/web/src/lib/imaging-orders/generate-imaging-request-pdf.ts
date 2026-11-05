import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loose } from "@/lib/clinician/loose-client";
import { DocumentFolioRefusedError, fetchDocumentFolios } from "@/lib/clinical/document-folio";
import { ImagingRequestDocument, type ImagingRequestData } from "./imaging-request-document";

export type GenerateImagingRequestPdfResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; error: "not_found" };

/**
 * The imaging request PDF for one order. Every read runs through the caller's own RLS session: a patient sees only their own
 * order, so a foreign id is "not found". The doctor's registration comes from the document-scoped folio function; a refusal
 * there means no PDF, never an unnumbered one.
 */
export async function generateImagingRequestPdf(supabase: SupabaseClient, orderId: string): Promise<GenerateImagingRequestPdfResult> {
  const db = loose(supabase);
  const { data: order } = await db
    .from("imaging_orders")
    .select("id, created_at, patient_id, status, urgency, indication, clinical_information, contraindication_information, ordering_clinician_id, study:imaging_studies(name)")
    .eq("id", orderId)
    .maybeSingle();
  const o = order as {
    id: string; created_at: string; patient_id: string; status: string; urgency: ImagingRequestData["urgency"]; indication: string;
    clinical_information: string | null; contraindication_information: string | null; ordering_clinician_id: string | null;
    study: { name: string } | null;
  } | null;
  if (!o || o.status === "cancelled") return { ok: false, error: "not_found" };

  const { data: patient } = await db.from("profiles").select("full_name, patient_number, date_of_birth, sex").eq("id", o.patient_id).maybeSingle();
  const p = patient as { full_name: string | null; patient_number: string | null; date_of_birth: string | null; sex: string | null } | null;
  if (!p) return { ok: false, error: "not_found" };

  let folio;
  try {
    folio = (await fetchDocumentFolios(supabase, "imaging_request", [o.id])).get(o.id);
  } catch (e) {
    if (e instanceof DocumentFolioRefusedError) return { ok: false, error: "not_found" };
    throw e;
  }

  const data: ImagingRequestData = {
    patientName: p.full_name ?? "Patient",
    patientNumber: p.patient_number,
    dateOfBirth: p.date_of_birth,
    sex: p.sex,
    orderedAt: o.created_at,
    studyName: o.study?.name ?? "Imaging study (see the reason below)",
    urgency: o.urgency,
    indication: o.indication,
    clinicalInformation: o.clinical_information,
    contraindicationInformation: o.contraindication_information,
    requestedByName: folio?.fullName ?? null,
    requestedByCredentialType: folio?.fullName ? folio.credentialType : null,
    requestedByCredentialNumber: folio?.fullName ? folio.credentialNumber : null,
  };
  const buffer = await renderToBuffer(ImagingRequestDocument({ data }));
  return { ok: true, buffer, filename: `tarragon-imaging-request-${o.id.slice(0, 8)}.pdf` };
}
