import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { loadPatientDocumentsForChart } from "@/lib/documents/clinician-documents";
import { DocumentClassificationReviewForm } from "./document-classification-review-form";
import { FlagDocumentDiscrepancyForm } from "./flag-document-discrepancy-form";
import { ResolveDocumentDiscrepancyForm } from "./resolve-document-discrepancy-form";
import { ArchivePatientDocumentButton } from "./archive-patient-document-button";
import { PublishPatientDocumentButton } from "./publish-patient-document-button";

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  laboratory_report: "Laboratory report",
  imaging_report: "Imaging report",
  referral_letter: "Referral letter",
  consultation_note: "Consultation note",
  prescription: "Prescription",
  discharge_summary: "Discharge summary",
  consent_form: "Consent form",
  invoice: "Invoice",
  insurance_document: "Insurance document",
  identification_document: "Identification document",
  clinical_photograph: "Clinical photograph",
  other: "Other document",
};

const SOURCE_LABEL: Record<string, string> = {
  patient: "Patient uploaded",
  clinician: "Clinician",
  care_coordinator: "Care Coordinator",
  admin: "Admin",
  lab_liaison: "Lab liaison",
  partner_lab: "Partner lab",
  external_provider: "External provider",
  system: "System",
};

const STATUS_BADGE: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  uploaded: { label: "Awaiting scan", variant: "grey" },
  validated: { label: "Awaiting publish", variant: "amber" },
  available: { label: "Available", variant: "green" },
  superseded: { label: "Superseded", variant: "blue" },
  archived: { label: "Archived", variant: "grey" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Clinician view of a patient's general document registry (Module 35 —
 * discharge summaries, referral letters, consultation notes, prescriptions,
 * and anything else that isn't lab_result_documents/ecg_report_documents'
 * own purpose-built pipelines, which keep their own sections). Read access
 * is enforced by patient_documents' own RLS; the clinical-judgment actions
 * here (review a classification mismatch, flag/resolve a discrepancy,
 * archive) are additionally gated on isClinicalTier so a Care Coordinator
 * sees the same list read-only, matching the platform's standing
 * non-clinical-write guardrail.
 */
export async function PatientDocumentsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadPatientDocumentsForChart(supabase, patientId);
  const callerStaff = await getCurrentClinicalStaff();
  const canActClinically = isClinicalTier(callerStaff);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          Discharge summaries, referral letters, consultation notes, prescriptions, and other filed
          documents. Lab results and ECGs have their own sections above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No documents on file yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {documents.map((doc) => {
              const statusBadge = STATUS_BADGE[doc.status] ?? { label: doc.status, variant: "grey" as const };
              const needsClassificationReview = doc.extraction?.classificationStatus === "needs_review";

              return (
                <li key={doc.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">{doc.title}</p>
                      <p className="text-xs text-charcoal-ink/60">
                        {DOCUMENT_TYPE_LABEL[doc.documentType] ?? doc.documentType}
                      </p>
                    </div>
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {SOURCE_LABEL[doc.source] ?? doc.source}
                    {doc.documentDate ? ` · ${formatDate(doc.documentDate)}` : ""}
                    {` · uploaded ${formatDate(doc.uploadedAt)}`}
                    {doc.originalFilename ? ` · ${doc.originalFilename}` : ""}
                  </p>

                  {doc.signedUrl && (
                    <a
                      href={doc.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-brand-green underline"
                    >
                      {doc.isPdf ? "View PDF" : "View file"}
                    </a>
                  )}

                  {needsClassificationReview && doc.extraction && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                      <p className="text-xs text-amber-900">
                        Suggested type:{" "}
                        <span className="font-medium">
                          {DOCUMENT_TYPE_LABEL[doc.extraction.suggestedDocumentType ?? ""] ??
                            doc.extraction.suggestedDocumentType}
                        </span>{" "}
                        (confidence{" "}
                        {doc.extraction.classificationConfidence !== null
                          ? `${Math.round(doc.extraction.classificationConfidence * 100)}%`
                          : "unknown"}
                        ) — filed as {DOCUMENT_TYPE_LABEL[doc.documentType] ?? doc.documentType}. The
                        filed type has not been changed; review and, if it&apos;s wrong, file a
                        corrected version.
                      </p>
                      {canActClinically && (
                        <DocumentClassificationReviewForm extractionId={doc.id} />
                      )}
                    </div>
                  )}
                  {doc.extraction?.classificationStatus === "reviewed" && doc.extraction.reviewNote && (
                    <p className="text-xs text-charcoal-ink/60">
                      Classification review: {doc.extraction.reviewNote}
                    </p>
                  )}

                  {doc.openDiscrepancies.length > 0 && (
                    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-800">Flagged discrepancies</p>
                      {doc.openDiscrepancies.map((discrepancy) => (
                        <div key={discrepancy.id} className="space-y-1">
                          <p className="text-xs text-red-900">
                            {discrepancy.fieldDescription}
                            {discrepancy.conflictingTable ? ` (${discrepancy.conflictingTable})` : ""}
                            {discrepancy.existingValue || discrepancy.documentValue
                              ? ` — on file "${discrepancy.existingValue ?? "—"}", document says "${
                                  discrepancy.documentValue ?? "—"
                                }"`
                              : ""}
                          </p>
                          {canActClinically && (
                            <ResolveDocumentDiscrepancyForm discrepancyId={discrepancy.id} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canActClinically && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {doc.status === "validated" && (
                        <PublishPatientDocumentButton documentId={doc.id} />
                      )}
                      <FlagDocumentDiscrepancyForm documentId={doc.id} />
                      {doc.status !== "archived" && (
                        <ArchivePatientDocumentButton documentId={doc.id} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
