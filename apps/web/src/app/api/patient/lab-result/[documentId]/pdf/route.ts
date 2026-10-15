import { renderToBuffer } from "@react-pdf/renderer";
import { DocumentFolioRefusedError, fetchDocumentFolios } from "@/lib/clinical/document-folio";
import { createClient } from "@/lib/supabase/server";
import {
  InterpretationDocument,
  type InterpretationData,
} from "@/lib/lab-results/interpretation-document";

/**
 * The PDF download for a doctor's interpretation of one uploaded lab result —
 * the "download it as a PDF" half of the Prevent-tier promise (the in-app
 * card in result-documents.tsx is the "just open it on the app" half).
 *
 * Cookie-session auth, and the read runs through the caller's own RLS-scoped
 * session — lab_result_documents_select only admits the patient themselves or
 * org staff, so a foreign documentId simply returns nothing and this 404s
 * rather than leaking that the document exists. 404s (rather than a blank/
 * error PDF) whenever no interpretation has been sent yet, matching the
 * in-app card's own gate on interpretation_sent_at.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: doc } = await supabase
    .from("lab_result_documents")
    .select(
      "id, patient_id, original_filename, created_at, patient_interpretation, next_steps, interpretation_sent_at, reviewed_by",
    )
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || !doc.patient_interpretation || !doc.interpretation_sent_at) {
    return new Response("Not found", { status: 404 });
  }

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", doc.patient_id)
    .maybeSingle();
  if (!patient) return new Response("Not found", { status: 404 });

  // Null-gated attribution, exactly like ReviewedByDoctor: a name is printed
  // only when a real clinical_staff row backs it.
  let doctorName: string | null = null;
  let doctorCredentialType: string | null = null;
  let doctorCredentialNumber: string | null = null;
  if (doc.reviewed_by) {
    // Folio via the document-scoped function, never the directory view (CMO Q17, OQ-358).
    let folio;
    try {
      folio = (
        await fetchDocumentFolios(supabase, "lab_result_interpretation", [doc.id], { [doc.id]: doc.reviewed_by })
      ).get(doc.id);
    } catch (e) {
      if (e instanceof DocumentFolioRefusedError) {
        return new Response("You are not permitted to produce this document", { status: 403 });
      }
      throw e;
    }
    if (folio?.fullName) {
      doctorName = folio.fullName;
      doctorCredentialType = folio.credentialType;
      doctorCredentialNumber = folio.credentialNumber;
    }
  }

  const data: InterpretationData = {
    patientName: patient.full_name ?? "Patient",
    documentTitle: doc.original_filename ?? "Lab result",
    uploadedAt: doc.created_at,
    interpretation: doc.patient_interpretation,
    nextSteps: doc.next_steps,
    interpretationSentAt: doc.interpretation_sent_at,
    doctorName,
    doctorCredentialType,
    doctorCredentialNumber,
  };

  const buffer = await renderToBuffer(InterpretationDocument({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="tarragon-result-interpretation.pdf"',
    },
  });
}
