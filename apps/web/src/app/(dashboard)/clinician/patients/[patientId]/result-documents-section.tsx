import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { loadResultDocuments } from "@/lib/lab-results/documents";
import { MarkResultReviewed } from "./mark-result-reviewed";
import { LabReportExtractionPanel, type ExtractionView } from "./lab-report-extraction-panel";
import type { ExtractedRow } from "@/lib/lab-reports/extract";

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
 * Clinician view of a patient's uploaded result documents. Files open via a
 * short-lived signed URL (org staff have no storage read policy — the row RLS
 * is the gate). Reviewing here records the interpretation; recording an abnormal
 * finding stays a separate, deliberate step via the screening-result form, so
 * the Cat 2->1 pipeline is never auto-triggered by an upload.
 */
export async function ResultDocumentsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadResultDocuments(supabase, patientId);

  // Extraction drafts, keyed by document. Org-staff RLS on
  // lab_report_extractions is the gate — a patient never sees these.
  const { data: extractionRows } = await supabase
    .from("lab_report_extractions")
    .select(
      "id, document_id, status, report_date, lab_name, patient_name_on_report, rows, unreadable_reason, error_message, confirmed_at, confirmed_codes",
    )
    .eq("patient_id", patientId);

  const extractionByDocument = new Map<string, ExtractionView>(
    (extractionRows ?? []).map((row) => [
      row.document_id,
      {
        id: row.id,
        status: row.status as ExtractionView["status"],
        reportDate: row.report_date,
        labName: row.lab_name,
        patientNameOnReport: row.patient_name_on_report,
        rows: (row.rows ?? []) as unknown as ExtractedRow[],
        unreadableReason: row.unreadable_reason,
        errorMessage: row.error_message,
        confirmedAt: row.confirmed_at,
        confirmedCodes: (row.confirmed_codes ?? []) as unknown as string[],
      },
    ]),
  );

  const { data: patient } = await supabase
    .from("profiles")
    .select("sex, full_name")
    .eq("id", patientId)
    .maybeSingle();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result documents</CardTitle>
        <CardDescription>
          Lab result files uploaded by the patient, a lab liaison, or a clinician. Review each, then
          record any finding via the screening result form.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No result documents uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {documents.map((doc) => (
              <li key={doc.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {doc.originalFilename ?? "Result"}
                  </p>
                  <Badge variant={doc.reviewedAt ? "green" : "amber"}>
                    {doc.reviewedAt ? "Reviewed" : "Awaiting review"}
                  </Badge>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {SOURCE_LABEL[doc.source] ?? doc.source} · {formatDate(doc.createdAt)}
                  {doc.note ? ` · ${doc.note}` : ""}
                </p>
                {doc.signedUrl ? (
                  <a
                    href={doc.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm font-medium text-brand-green hover:underline"
                  >
                    {doc.isPdf ? "Open result (PDF) →" : "View result →"}
                  </a>
                ) : (
                  <p className="text-xs text-red-600">File could not be loaded.</p>
                )}
                <LabReportExtractionPanel
                  documentId={doc.id}
                  signedUrl={doc.signedUrl}
                  isPdf={doc.isPdf}
                  patientSex={patient?.sex ?? null}
                  patientName={patient?.full_name ?? null}
                  extraction={extractionByDocument.get(doc.id) ?? null}
                />
                {doc.reviewedAt ? (
                  <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
                ) : (
                  <MarkResultReviewed documentId={doc.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
