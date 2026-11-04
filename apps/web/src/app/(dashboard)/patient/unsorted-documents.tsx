import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { UnsortedDocumentsPanel, type KindOption, type UnsortedDocumentView } from "./unsorted-documents-panel";

/**
 * "Not sure what a document is?" on the patient's Documents tab (clinical document engine step 4): the upload, and the patient's own
 * uploads that have not gone to a reader yet, with the one question when the type is not known. A document routed into the lab path
 * appears in the lab result list instead, so it is not shown twice. Reads through the patient's own session (RLS: visible_to_patient).
 * The upload and the question appear only on the signed-in patient's own record.
 */
export async function UnsortedDocuments({ patientId }: { patientId: string }) {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const [{ data: docs }, { data: kindRows }] = await Promise.all([
    supabase
      .from("clinical_documents")
      .select("id, original_filename, created_at, status, status_reason, kind_code, suggested_kind_code")
      .eq("patient_id", patientId)
      .is("routed_table", null)
      .eq("visible_to_patient", true)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("clinical_document_kinds")
      .select("code, label, parent_code, pipeline, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const all = kindRows ?? [];
  const labelOf = new Map(all.map((k) => [k.code, k.label]));
  const kinds: KindOption[] = all
    .filter((k) => k.pipeline !== null)
    .map((k) => {
      const root = k.code.split(".")[0] ?? k.code;
      return { code: k.code, label: k.label, group: labelOf.get(root) ?? "Other" };
    });

  const documents: UnsortedDocumentView[] = (docs ?? []).map((d) => ({
    id: d.id,
    fileName: d.original_filename,
    uploadedAt: d.created_at,
    status: d.status,
    statusReason: d.status_reason,
    kindLabel: d.kind_code ? labelOf.get(d.kind_code) ?? null : null,
    suggestedKind: d.suggested_kind_code && kinds.some((k) => k.code === d.suggested_kind_code) ? d.suggested_kind_code : null,
  }));

  return <UnsortedDocumentsPanel documents={documents} kinds={kinds} canUpload={user?.id === patientId} />;
}
