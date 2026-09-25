import { renderToBuffer } from "@react-pdf/renderer";
import { createBearerClient } from "@/lib/supabase/bearer";
import { VerifiedDocumentPdf } from "@/lib/verified-documents/verified-document";

/**
 * Native counterpart to /api/patient/verified-documents/[id]/pdf — same
 * VerifiedDocumentPdf render, same RLS-scoped authority, just reached by a
 * bearer-authenticated Expo client instead of a cookie session (see
 * lib/supabase/bearer.ts). Only status='issued' documents can be
 * downloaded: attestation_text/valid_from are guaranteed present by
 * verified_documents_issued_has_attestation, so there's nothing to
 * null-check on that half.
 *
 * The token is accepted two ways: the `Authorization: Bearer` header for a
 * plain authenticated fetch, or a `?token=` query param for the one case a
 * header can't be attached — opening this URL in expo-web-browser's
 * in-app Safari view (so the patient gets Safari's own PDF viewer, with its
 * own Print/Share/Save-to-Files toolbar, for free). The query-param token is
 * exactly the same short-lived Supabase access token the header form would
 * carry — never a separate, longer-lived credential — and every read it
 * unlocks is still RLS-scoped to that one session, same as the header path.
 * Mirrors /api/mobile/lab-order/[orderId]/request's dual header-or-query-
 * token acceptance.
 *
 * `inline` rather than the cookie route's `attachment`: a mobile patient
 * wants to see the document immediately in Safari's viewer, not have it
 * silently land in Files.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  const authHeader = request.headers.get("authorization");
  const headerToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  const queryToken = new URL(request.url).searchParams.get("token") ?? undefined;
  const accessToken = headerToken ?? queryToken;
  if (!accessToken) {
    return new Response("Missing bearer token", { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return new Response("Invalid or expired session", { status: 401 });
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
    const { data: issuerStaff } = await supabase
      .from("clinical_staff_directory")
      .select("credential_type, credential_number, profile_id")
      .eq("id", doc.issued_by)
      .maybeSingle();
    if (issuerStaff) {
      issuer = { credential_type: issuerStaff.credential_type, credential_number: issuerStaff.credential_number };
      if (issuerStaff.profile_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", issuerStaff.profile_id)
          .maybeSingle();
        issuerProfile = profile ?? null;
      }
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
      "Content-Disposition": `inline; filename="${doc.document_type}-${doc.id.slice(0, 8)}.pdf"`,
    },
  });
}
