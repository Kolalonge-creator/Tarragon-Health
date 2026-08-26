import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { loadEcgReportDocuments } from "@/lib/ecg-reports/documents";
import { MarkEcgReportReviewed } from "./mark-ecg-report-reviewed";
import { EcgReportExtractionPanel, type EcgExtractionView } from "./ecg-report-extraction-panel";
import type { ExtractedParameter } from "@/lib/ecg-reports/extract";

const SOURCE_LABEL: Record<string, string> = {
  patient: "Patient uploaded",
  lab_liaison: "Lab liaison",
  clinician: "Clinician",
  admin: "Admin",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Clinician view of a patient's uploaded 12-lead ECGs. Mirrors
 * result-documents-section.tsx exactly, for the same reason
 * ecg_report_documents is a genuinely separate table from
 * lab_result_documents — see that migration's header comment. Reviewing here
 * records the transcription review; the clinician's own clinical read of the
 * tracing stays a separate, deliberate step via the screening result form's
 * procedural_status field for ecg_resting, so nothing here auto-triggers the
 * abnormal-result pipeline.
 */
export async function EcgReportDocumentsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadEcgReportDocuments(supabase, patientId);

  // Extraction drafts, keyed by document. Org-staff RLS on
  // ecg_report_extractions is the gate — a patient never sees these.
  const { data: extractionRows } = await supabase
    .from("ecg_report_extractions")
    .select(
      "id, document_id, status, report_date, facility_name, patient_name_on_report, looks_twelve_lead, parameters, unreadable_reason, error_message, confirmed_at, confirmed_codes",
    )
    .eq("patient_id", patientId);

  const extractionByDocument = new Map<string, EcgExtractionView>(
    (extractionRows ?? []).map((row) => {
      const parameters = (row.parameters ?? []) as unknown as ExtractedParameter[];
      return [
        row.document_id,
        {
          id: row.id,
          status: row.status as EcgExtractionView["status"],
          reportDate: row.report_date,
          facilityName: row.facility_name,
          patientNameOnReport: row.patient_name_on_report,
          // Null (extraction failed, no judgement was made) reads as "treat
          // as unconfirmed" here — the panel's warning is a prompt to check,
          // not a diagnosis, so defaulting to false costs nothing.
          looksTwelveLead: row.looks_twelve_lead ?? false,
          parameters,
          unreadableReason: row.unreadable_reason,
          errorMessage: row.error_message,
          confirmedAt: row.confirmed_at,
          confirmedCodes: (row.confirmed_codes ?? []) as unknown as string[],
        },
      ];
    }),
  );

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", patientId)
    .maybeSingle();

  return (
    <Card>
      <CardHeader>
        <CardTitle>12-lead ECGs</CardTitle>
        <CardDescription>
          ECG tracings uploaded by the patient, a lab liaison, or a clinician. Review each, then
          record your own read via the screening result form.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No ECGs uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {documents.map((doc) => (
              <li key={doc.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {doc.originalFilename ?? "ECG"}
                  </p>
                  <Badge variant={doc.reviewedAt ? "green" : "amber"}>
                    {doc.reviewedAt ? "Reviewed" : "Awaiting review"}
                  </Badge>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {SOURCE_LABEL[doc.source] ?? doc.source} · {formatDate(doc.createdAt)}
                  {doc.note ? ` · ${doc.note}` : ""}
                </p>
                <EcgReportExtractionPanel
                  documentId={doc.id}
                  signedUrl={doc.signedUrl}
                  isPdf={doc.isPdf}
                  patientName={patient?.full_name ?? null}
                  extraction={extractionByDocument.get(doc.id) ?? null}
                />
                {doc.reviewedAt ? (
                  <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
                ) : (
                  <MarkEcgReportReviewed documentId={doc.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
