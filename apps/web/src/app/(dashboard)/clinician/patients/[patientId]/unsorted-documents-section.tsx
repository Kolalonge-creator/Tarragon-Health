import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { UnsortedDocumentReviewForm } from "./unsorted-document-review-form";
import { PathologyReportForm } from "./pathology-report-form";

/**
 * Documents the patient uploaded through "Not sure what a document is?" that are not a lab result (clinical document engine step 4):
 * an ECG, scan, letter or pathology report kept on the record until its reader is routed through the intake (step 5). This is where
 * the review alert for one of them points. Rows come through the clinician's own session (RLS: private.staff_may_read in the
 * document's category); only then is the file signed for five minutes. Hidden when there is nothing to show.
 */
export async function UnsortedDocumentsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("clinical_documents")
    .select("id, kind_code, kind_source, status, file_path, original_filename, patient_note, created_at, reviewed_at, review_note")
    .eq("patient_id", patientId)
    .is("routed_table", null)
    .not("kind_code", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (!rows || rows.length === 0) return null;

  const [{ data: kinds }, signed] = await Promise.all([
    supabase.from("clinical_document_kinds").select("code, label, pipeline"),
    signStoragePaths(RESULT_DOC_BUCKET, rows.flatMap((r) => (r.file_path ? [r.file_path] : [])), 300),
  ]);
  const label = new Map((kinds ?? []).map((k) => [k.code, k.label]));
  const pipelineOf = new Map((kinds ?? []).map((k) => [k.code, k.pipeline]));
  const SOURCE: Record<string, string> = { confirmed: "type chosen by the patient", ai: "type suggested by AI-024", rules: "type from the file name" };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded documents not yet read automatically</CardTitle>
        <CardDescription>
          The patient uploaded these and they were sorted by type, but no automatic reader handles this type yet. Open the original and
          record your review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {rows.map((r) => {
            const url = r.file_path ? signed.get(r.file_path) ?? null : null;
            return (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{label.get(r.kind_code ?? "") ?? r.kind_code}</span>
                  <Badge variant={r.reviewed_at ? "green" : "amber"}>{r.reviewed_at ? "Reviewed" : "Waiting for review"}</Badge>
                  <span className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                    {formatPatientDate(r.created_at)} · {SOURCE[r.kind_source ?? ""] ?? r.kind_source}
                  </span>
                </div>
                {r.patient_note && <p className="mt-1 text-sm">Patient&apos;s note: {r.patient_note}</p>}
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-green hover:underline">
                    Open {r.original_filename ?? "the document"}
                  </a>
                ) : (
                  <p className="text-sm text-charcoal-ink/60">The file could not be opened just now. Refresh to try again.</p>
                )}
                {r.reviewed_at ? (
                  <p className="mt-1 text-sm">Review: {r.review_note}</p>
                ) : pipelineOf.get(r.kind_code ?? "") === "pathology" || pipelineOf.get(r.kind_code ?? "") === "cervical" ? (
                  // Step 5b: a pathology or cervical result is filed as printed; filing records the review.
                  <PathologyReportForm documentId={r.id} patientId={patientId} pipeline={pipelineOf.get(r.kind_code ?? "") as "pathology" | "cervical"} />
                ) : (
                  <UnsortedDocumentReviewForm documentId={r.id} patientId={patientId} />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
