import { createClient } from "@/lib/supabase/server";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { ReportDocumentList } from "@/components/report-document-list";
import {
  loadResultDocuments,
  type ResultDocumentView,
} from "@/lib/lab-results/documents";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { ReplaceResultDocumentForm } from "./replace-result-document-form";
import { ResultDocumentsDownloadPicker } from "./result-documents-download-picker";
import { AiResultSummary } from "./ai-result-summary";

/** Groups documents by their known test type, most-recently-updated group
 * first, with anything of unknown type (uploaded before this field existed,
 * or "something else / not sure") trailing under "Other results" — grouping
 * only ever reorders within what test-type data exists, it never hides a
 * document or changes its own review state. */
function groupByTestType(
  documents: ResultDocumentView[],
): { label: string; documents: ResultDocumentView[] }[] {
  const order: string[] = [];
  const byLabel = new Map<string, ResultDocumentView[]>();
  for (const doc of documents) {
    const label = doc.testCode ? testCodeLabel(doc.testCode) : "Other results";
    if (!byLabel.has(label)) {
      order.push(label);
      byLabel.set(label, []);
    }
    byLabel.get(label)!.push(doc);
  }
  // "Other results" always trails, even if its documents are the most recent
  // — it is a catch-all, not a genuine test type to surface first.
  return order
    .filter((label) => label !== "Other results")
    .concat(byLabel.has("Other results") ? ["Other results"] : [])
    .map((label) => ({ label, documents: byLabel.get(label)! }));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Patient-facing list of raw result documents (PDFs/images) on their record —
 * uploaded either by the patient themselves or by a Lab Liaison Officer /
 * clinician on their behalf. Each file opens via a short-lived signed URL
 * (never a public link). Once a doctor sends an interpretation
 * (markResultDocumentReviewed), it and any next steps appear inline, with a
 * link to download it as a PDF — the "upload any lab result and a doctor's
 * plain-language interpretation is sent to you in the app" plan feature.
 * Always renders the upload form so a patient can add a result they received
 * directly.
 *
 * Shares its card/list/badge/signed-URL-link/reviewed-block structure with
 * EcgReportDocuments/ImagingReportDocuments via ReportDocumentList — this
 * component supplies only what's genuinely specific to a lab result: the
 * test-type grouping, the interpretation/next-steps reviewed block, and the
 * multi-result download picker.
 */
export async function ResultDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadResultDocuments(supabase, patientId);
  const interpreted = documents.filter(
    (doc) => doc.interpretationSentAt && doc.patientInterpretation,
  );
  const groups = groupByTestType(documents);

  return (
    <ReportDocumentList
      title="Result documents"
      description="Lab result files on your record. Once a doctor has read one, their interpretation and any next steps appear here."
      emptyText="No result documents yet."
      fallbackFilename="Result"
      groups={groups}
      isReviewed={(doc) => Boolean(doc.interpretationSentAt && doc.patientInterpretation)}
      badgeReviewed={(doc) => Boolean(doc.interpretationSentAt)}
      reviewedLabel="Interpreted"
      renderReviewed={(doc) => (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/5 dark:bg-brand-green/15 p-3">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            {doc.patientInterpretation}
          </p>
          {doc.nextSteps && (
            <p className="mt-2 text-sm text-charcoal-ink dark:text-night-ink">
              <span className="font-medium">Next steps:</span> {doc.nextSteps}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
            <a
              href={`/api/patient/lab-result/${doc.id}/pdf`}
              className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              Download as PDF →
            </a>
          </div>
        </div>
      )}
      renderPending={(doc) => (
        <>
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Your care team hasn&apos;t reviewed this yet. We&apos;ll let you know here as soon as
            they have.
          </p>
          <AiResultSummary status={doc.aiSummaryStatus} flaggedAnalytes={doc.aiFlaggedAnalytes} />
          {doc.source === "patient" && !doc.reviewedAt && (
            <ReplaceResultDocumentForm documentId={doc.id} />
          )}
        </>
      )}
      footer={
        <>
          {interpreted.length >= 2 && (
            <ResultDocumentsDownloadPicker
              results={interpreted.map((doc) => ({
                id: doc.id,
                label: `${doc.originalFilename ?? "Result"} (${formatDate(doc.createdAt)})`,
              }))}
            />
          )}
          <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
            <PatientResultUpload label="Upload a result" patientId={patientId} />
          </div>
        </>
      }
    />
  );
}
