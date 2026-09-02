import { renderToBuffer } from "@react-pdf/renderer";
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
    .select(
      "id, document_type, attestation_text, valid_from, valid_until, issued_at, status, patient_id, issuer:clinical_staff!verified_documents_issued_by_fkey(credential_type, credential_number, profile:profiles!clinical_staff_profile_id_fkey(full_name))"
    )
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

  const issuer = Array.isArray(doc.issuer) ? doc.issuer[0] : doc.issuer;
  const issuerProfile = issuer ? (Array.isArray(issuer.profile) ? issuer.profile[0] : issuer.profile) : null;

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
