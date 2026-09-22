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
import { loadEcgReportDocuments } from "@/lib/ecg-reports/documents";
import { EcgReportUpload } from "@/components/ecg-report-upload";
import { AiEcgSummary } from "@/components/ai-ecg-summary";

function sourceLabel(source: string): string {
  return source === "patient" ? "You uploaded this" : "Uploaded by your care team";
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
 * Patient-facing list of uploaded 12-lead ECG documents — mirrors
 * ResultDocuments (result-documents.tsx) exactly in structure and
 * discipline, adapted to what an ECG document carries: no
 * patientInterpretation/nextSteps fields (there's no structured
 * ecg_analyte_readings-equivalent this platform files onto the record from
 * a review, only the reviewedAt/reviewNote stamp), so a reviewed ECG shows
 * the doctor's own review note when they left one, otherwise just the
 * "reviewed" badge. Always renders a standalone upload form (no
 * labOrderId) so a patient can add an ECG they already have — the entry
 * point EcgReportUpload's own docstring says exists but that, before this,
 * was never actually mounted anywhere a patient could reach it standalone.
 */
export async function EcgReportDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadEcgReportDocuments(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ECG results</CardTitle>
        <CardDescription>
          12-lead ECGs on your record — from a hospital, lab, or clinic visit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No ECGs uploaded yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-4 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {doc.originalFilename ?? "ECG"}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={doc.reviewedAt ? "green" : "amber"}>
                      {doc.reviewedAt ? "Reviewed" : "Awaiting review"}
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
                    {doc.isPdf ? "Open original (PDF) →" : "View original →"}
                  </a>
                ) : (
                  <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                    File unavailable.
                  </p>
                )}
                {doc.reviewedAt ? (
                  <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/5 dark:bg-brand-green/15 p-3">
                    {doc.reviewNote && (
                      <p className="text-sm text-charcoal-ink dark:text-night-ink">
                        {doc.reviewNote}
                      </p>
                    )}
                    <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                      Your care team hasn&apos;t reviewed this yet. We&apos;ll let you know here
                      as soon as they have.
                    </p>
                    <AiEcgSummary
                      status={doc.aiSummaryStatus}
                      statement={doc.aiRhythmStatement}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <EcgReportUpload label="Upload an ECG" />
        </div>
      </CardContent>
    </Card>
  );
}
