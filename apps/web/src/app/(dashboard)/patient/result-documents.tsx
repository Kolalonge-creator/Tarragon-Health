import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import {
  loadResultDocuments,
  type ResultDocumentView,
} from "@/lib/lab-results/documents";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import { UploadResultForm } from "./upload-result-form";
import { ResultDocumentsDownloadPicker } from "./result-documents-download-picker";
import { AiResultSummary } from "./ai-result-summary";

function sourceLabel(source: string): string {
  return source === "patient"
    ? "You uploaded this"
    : "Uploaded by your care team";
}

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
 */
export async function ResultDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadResultDocuments(supabase, patientId);
  const interpreted = documents.filter(
    (doc) => doc.interpretationSentAt && doc.patientInterpretation,
  );
  const groups = groupByTestType(documents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result documents</CardTitle>
        <CardDescription>
          Lab result files on your record. Once a doctor has read one, their
          interpretation and any next steps appear here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No result documents yet.
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.label} className="space-y-3">
                {groups.length > 1 && (
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
                    {group.label}
                  </h4>
                )}
                <ul className="space-y-4">
                  {group.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                          {doc.originalFilename ?? "Result"}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={
                              doc.interpretationSentAt ? "green" : "amber"
                            }
                          >
                            {doc.interpretationSentAt
                              ? "Interpreted"
                              : "Awaiting review"}
                          </Badge>
                          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                            {formatDate(doc.createdAt)}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        {sourceLabel(doc.source)}
                        {doc.note ? ` · ${doc.note}` : ""}
                      </p>
                      {doc.signedUrl ? (
                        <a
                          href={doc.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
                        >
                          {doc.isPdf
                            ? "Open original (PDF) →"
                            : "View original →"}
                        </a>
                      ) : (
                        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                          File unavailable.
                        </p>
                      )}
                      {doc.interpretationSentAt && doc.patientInterpretation ? (
                        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/5 dark:bg-brand-green/15 p-3">
                          <p className="text-sm text-charcoal-ink dark:text-night-ink">
                            {doc.patientInterpretation}
                          </p>
                          {doc.nextSteps && (
                            <p className="mt-2 text-sm text-charcoal-ink dark:text-night-ink">
                              <span className="font-medium">Next steps:</span>{" "}
                              {doc.nextSteps}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <ReviewedResultLine
                              reviewedBy={doc.reviewedBy}
                              reviewedAt={doc.reviewedAt}
                            />
                            <a
                              href={`/api/patient/lab-result/${doc.id}/pdf`}
                              className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
                            >
                              Download as PDF →
                            </a>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                            Your care team hasn&apos;t reviewed this yet.
                            We&apos;ll let you know here as soon as they have.
                          </p>
                          <AiResultSummary status={doc.aiSummaryStatus} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {interpreted.length >= 2 && (
          <ResultDocumentsDownloadPicker
            results={interpreted.map((doc) => ({
              id: doc.id,
              label: `${doc.originalFilename ?? "Result"} (${formatDate(doc.createdAt)})`,
            }))}
          />
        )}
        <UploadResultForm />
      </CardContent>
    </Card>
  );
}
