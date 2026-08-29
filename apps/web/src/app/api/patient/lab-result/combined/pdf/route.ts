import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  CombinedInterpretationDocument,
  type InterpretationData,
} from "@/lib/lab-results/interpretation-document";

/**
 * Several interpreted results, picked by the caller, combined into one PDF —
 * the "one PDF for multiple tests" alternative to downloading each result's
 * own PDF separately (the per-document route already covers "separate").
 * Which one a person wants is a download-time choice made in
 * result-documents.tsx's checkboxes, not a stored preference.
 *
 * ?ids=uuid,uuid,... — every id is loaded through the caller's own
 * RLS-scoped session (same gate as the single-result route), so an id that
 * isn't the caller's own (or has no interpretation sent yet) is silently
 * dropped rather than erroring the whole request; a caller who picked
 * documents they can see should still get the PDF for the rest. 404s only
 * when NONE of the requested ids resolve.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return new Response("No results selected", { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: docs } = await supabase
    .from("lab_result_documents")
    .select(
      "id, patient_id, original_filename, created_at, patient_interpretation, next_steps, interpretation_sent_at, reviewed_by",
    )
    .in("id", ids)
    .not("patient_interpretation", "is", null)
    .not("interpretation_sent_at", "is", null)
    .order("interpretation_sent_at", { ascending: true });
  if (!docs || docs.length === 0) return new Response("Not found", { status: 404 });

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", docs[0]!.patient_id)
    .maybeSingle();
  if (!patient) return new Response("Not found", { status: 404 });

  // Batch the doctor lookups rather than one round trip per document.
  const reviewerIds = Array.from(
    new Set(docs.map((d) => d.reviewed_by).filter((id): id is string => !!id)),
  );
  const { data: staffRows } = reviewerIds.length
    ? await supabase
        .from("clinical_staff")
        .select("profile_id, full_name, credential_type, credential_number")
        .in("profile_id", reviewerIds)
        .eq("active", true)
    : { data: [] };
  const staffByProfileId = new Map((staffRows ?? []).map((s) => [s.profile_id, s]));

  const items: InterpretationData[] = docs.map((doc) => {
    const staff = doc.reviewed_by ? staffByProfileId.get(doc.reviewed_by) : undefined;
    return {
      patientName: patient.full_name ?? "Patient",
      documentTitle: doc.original_filename ?? "Lab result",
      uploadedAt: doc.created_at,
      // Non-null: filtered by the query above.
      interpretation: doc.patient_interpretation!,
      nextSteps: doc.next_steps,
      interpretationSentAt: doc.interpretation_sent_at!,
      doctorName: staff?.full_name ?? null,
      doctorCredentialType: staff?.credential_type ?? null,
      doctorCredentialNumber: staff?.credential_number ?? null,
    };
  });

  const buffer = await renderToBuffer(CombinedInterpretationDocument({ items }));

  // §1.24 export audit trail — best-effort, never blocks the download.
  await supabase.rpc("record_export_access", {
    p_patient_id: docs[0]!.patient_id,
    p_export_type: "lab_result_combined",
    p_metadata: { document_ids: docs.map((d) => d.id) },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="tarragon-result-interpretations.pdf"',
    },
  });
}
