import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { loadResultDocuments } from "@/lib/lab-results/documents";
import { MarkResultReviewed } from "./mark-result-reviewed";
import { MarkActionCompletedButton } from "./mark-action-completed-button";
import { LabReportExtractionPanel, type ExtractionView } from "./lab-report-extraction-panel";
import type { ExtractedRow } from "@/lib/lab-reports/extract";
import type { Database } from "@tarragon/shared";

const SOURCE_LABEL: Record<string, string> = {
  patient: "Patient uploaded",
  lab_liaison: "Lab liaison",
  clinician: "Clinician",
  admin: "Admin",
};

type AckStatus = Database["public"]["Enums"]["result_document_acknowledgement_status"];

/** Care Team / Provider Workspace §5.7's five states, in order. */
const ACK_STATUS_BADGE: Record<AckStatus, { label: string; variant: "grey" | "blue" | "green" | "amber" }> = {
  new: { label: "New", variant: "grey" },
  opened: { label: "Opened", variant: "blue" },
  reviewed: { label: "Reviewed", variant: "green" },
  action_required: { label: "Action required", variant: "amber" },
  action_completed: { label: "Action completed", variant: "green" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Whole years since a date of birth, or null when it is absent or unusable. */
function ageFromDob(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years >= 0 && years < 130 ? Math.floor(years) : null;
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

  // Read-access audit (Care Team / Provider Workspace §5.20), same shape and
  // same best-effort-never-blocks-the-view rule as log_patient_record_view
  // (20260812034612): one call per document a signed URL was actually
  // generated for — that's the point at which access was granted and shown,
  // not merely listed. See 20260827202722_clinician_audit_gaps.sql.
  await Promise.all(
    documents
      .filter((doc) => doc.signedUrl)
      .map(async (doc) => {
        const { error } = await supabase.rpc("log_result_document_viewed", {
          p_document_id: doc.id,
        });
        if (error) {
          console.error("Failed to log result document view", error);
        }
      }),
  );

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
    .select("sex, full_name, date_of_birth")
    .eq("id", patientId)
    .maybeSingle();

  // Age drives the age-banded PSA range and the eGFR estimate. Null when the
  // patient has no recorded date of birth, and every range that needs it
  // degrades to a stated fallback rather than guessing.
  const patientAgeYears = ageFromDob(patient?.date_of_birth ?? null);

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
                  <Badge variant={ACK_STATUS_BADGE[doc.acknowledgementStatus].variant}>
                    {ACK_STATUS_BADGE[doc.acknowledgementStatus].label}
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
                  patientAgeYears={patientAgeYears}
                  patientName={patient?.full_name ?? null}
                  extraction={extractionByDocument.get(doc.id) ?? null}
                />
                {doc.reviewedAt ? (
                  <div className="space-y-1.5">
                    <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
                    {doc.patientInterpretation && (
                      <div className="rounded-lg border border-brand-green/20 bg-brand-green/5 p-2.5 text-sm text-charcoal-ink">
                        <p className="text-xs font-medium text-brand-green">Sent to patient</p>
                        <p className="mt-0.5">{doc.patientInterpretation}</p>
                        {doc.nextSteps && (
                          <p className="mt-1.5 text-charcoal-ink/70">
                            <span className="font-medium">Next steps:</span> {doc.nextSteps}
                          </p>
                        )}
                      </div>
                    )}
                    {doc.acknowledgementStatus === "action_required" && (
                      <MarkActionCompletedButton documentId={doc.id} />
                    )}
                  </div>
                ) : (
                  <MarkResultReviewed
                    documentId={doc.id}
                    extraction={extractionByDocument.get(doc.id) ?? null}
                    patientSex={patient?.sex ?? null}
                    patientAgeYears={patientAgeYears}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
