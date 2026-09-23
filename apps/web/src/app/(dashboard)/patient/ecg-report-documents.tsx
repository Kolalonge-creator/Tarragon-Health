import { createClient } from "@/lib/supabase/server";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { ReportDocumentList } from "@/components/report-document-list";
import { loadEcgReportDocuments } from "@/lib/ecg-reports/documents";
import { EcgReportUpload } from "@/components/ecg-report-upload";
import { AiEcgSummary } from "@/components/ai-ecg-summary";

/**
 * Patient-facing list of uploaded 12-lead ECG documents — shares its
 * card/list/badge/signed-URL-link/reviewed-block structure with
 * ResultDocuments (result-documents.tsx) via ReportDocumentList, adapted to
 * what an ECG document carries: no patientInterpretation/nextSteps fields
 * (there's no structured ecg_analyte_readings-equivalent this platform files
 * onto the record from a review, only the reviewedAt/reviewNote stamp), so a
 * reviewed ECG shows the doctor's own review note when they left one,
 * otherwise just the "reviewed" badge. Always renders a standalone upload
 * form (no labOrderId) so a patient can add an ECG they already have — the
 * entry point EcgReportUpload's own docstring says exists but that, before
 * this, was never actually mounted anywhere a patient could reach it
 * standalone.
 */
export async function EcgReportDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadEcgReportDocuments(supabase, patientId);

  return (
    <ReportDocumentList
      title="ECG results"
      description="12-lead ECGs on your record — from a hospital, lab, or clinic visit."
      emptyText="No ECGs uploaded yet."
      fallbackFilename="ECG"
      groups={[{ label: "", documents }]}
      isReviewed={(doc) => Boolean(doc.reviewedAt)}
      renderReviewed={(doc) => (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/5 dark:bg-brand-green/15 p-3">
          {doc.reviewNote && (
            <p className="text-sm text-charcoal-ink dark:text-night-ink">{doc.reviewNote}</p>
          )}
          <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
        </div>
      )}
      renderPending={(doc) => (
        <>
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Your care team hasn&apos;t reviewed this yet. We&apos;ll let you know here as soon as
            they have.
          </p>
          <AiEcgSummary status={doc.aiSummaryStatus} statement={doc.aiRhythmStatement} />
        </>
      )}
      footer={
        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <EcgReportUpload label="Upload an ECG" />
        </div>
      }
    />
  );
}
