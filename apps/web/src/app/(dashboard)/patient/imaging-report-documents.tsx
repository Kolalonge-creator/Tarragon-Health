import { createClient } from "@/lib/supabase/server";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { ReportDocumentList } from "@/components/report-document-list";
import { loadImagingReportDocuments } from "@/lib/imaging-reports/documents";
import { ImagingReportUpload } from "@/components/imaging-report-upload";
import { AiImagingSummary } from "@/components/ai-imaging-summary";

/**
 * Patient-facing list of uploaded imaging/radiology report documents —
 * shares its card/list/badge/signed-URL-link/reviewed-block structure with
 * EcgReportDocuments and ResultDocuments via ReportDocumentList. Before this
 * component existed, ImagingReportUpload was a real, working, tested
 * component that no page anywhere ever mounted — a patient had a working
 * upload action and a real storage bucket, but genuinely no way to reach
 * either. This is the first patient-facing surface for imaging reports on
 * the platform.
 *
 * AI-016 (the automated summary's read of the radiologist's own Impression)
 * ships disabled pending evaluation — see ai-imaging-summary.tsx's own
 * comment. Everything else here (upload, the file list, the existing
 * clinician-review alert) works today regardless.
 */
export async function ImagingReportDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadImagingReportDocuments(supabase, patientId);

  return (
    <ReportDocumentList
      title="Imaging results"
      description="X-ray, ultrasound, CT, MRI, or other scan reports on your record."
      emptyText="No imaging reports uploaded yet."
      fallbackFilename="Imaging report"
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
          <AiImagingSummary status={doc.aiSummaryStatus} impressionText={doc.aiImpressionText} />
        </>
      )}
      footer={
        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <ImagingReportUpload label="Upload an imaging report" />
        </div>
      }
    />
  );
}
