import { renderToBuffer } from "@react-pdf/renderer";
import { DocumentFolioRefusedError, fetchDocumentFolios } from "@/lib/clinical/document-folio";
import { createClient } from "@/lib/supabase/server";
import { VerifiedDocumentPdf } from "@/lib/verified-documents/verified-document";

/**
 * Streams an issued verified_documents row as a downloadable PDF — same
 * cookie-session, RLS-scoped-to-caller shape as the Health Passport PDF
 * route. Only status='issued' documents can be downloaded: attestation_text/
 * valid_from are guaranteed present by verified_documents_issued_has_
 * attestation, so there's nothing to null-check on that half.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const { data: doc } = await supabase
    .from("verified_documents")
    .select("id, document_type, attestation_text, valid_from, valid_until, issued_at, status, patient_id, issued_by")
    .eq("id", id)
    .maybeSingle();

  if (!doc || doc.status !== "issued" || !doc.attestation_text || !doc.valid_from) {
    return new Response("Not found", { status: 404 });
  }

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth")
    .eq("id", doc.patient_id)
    .single();
  if (!patient) {
    return new Response("Not found", { status: 404 });
  }

  // `issuer` used to be embedded directly via
  // clinical_staff!verified_documents_issued_by_fkey(...) — a PostgREST
  // embedded join, which resolves against clinical_staff's OWN RLS, not this
  // query's own. Since 2026-09-25 (see
  // 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
  // that policy no longer admits a patient session, so the embed would
  // silently come back null on every download. Fetching the issuer
  // separately from public.clinical_staff_directory (the safe-column view
  // every patient-facing clinical_staff read now uses) restores the same
  // attestation without reopening the column-exposure gap that migration
  // fixed. The name still comes from profiles.full_name (the login identity),
  // not clinical_staff.full_name, matching the original embed's shape exactly.
  let issuer: { credential_type: string | null; credential_number: string | null } | null = null;
  let issuerProfile: { full_name: string | null } | null = null;
  if (doc.issued_by) {
    // Folio via the document-scoped function, never the directory view (CMO Q17, OQ-358).
    let folio;
    try {
      folio = (
        await fetchDocumentFolios(supabase, "verified_document", [doc.id])
      ).get(doc.id);
    } catch (e) {
      if (e instanceof DocumentFolioRefusedError) {
        return new Response("You are not permitted to produce this document", { status: 403 });
      }
      throw e;
    }
    if (folio) {
      issuer = { credential_type: folio.credentialType, credential_number: folio.credentialNumber };
      if (folio.clinicianProfileId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", folio.clinicianProfileId)
          .maybeSingle();
        issuerProfile = profile ?? null;
      }
      // A patient session cannot read the clinician's profile; fall back to the directory name
      // the function returns so the issuer is never printed without a name.
      if (!issuerProfile?.full_name && folio.fullName) issuerProfile = { full_name: folio.fullName };
    }
  }

  const buffer = await renderToBuffer(
    VerifiedDocumentPdf({
      data: {
        patientName: patient.full_name ?? "Patient",
        patientNumber: patient.patient_number,
        dateOfBirth: patient.date_of_birth,
        documentType: doc.document_type,
        documentId: doc.id,
        attestationText: doc.attestation_text,
        validFrom: doc.valid_from,
        validUntil: doc.valid_until,
        issuedAt: doc.issued_at ?? doc.valid_from,
        issuerName: issuerProfile?.full_name ?? null,
        issuerCredentialType: issuer?.credential_type ?? null,
        issuerCredential: issuer?.credential_number ?? null,
      },
    })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.document_type}-${doc.id.slice(0, 8)}.pdf"`,
    },
  });
}
