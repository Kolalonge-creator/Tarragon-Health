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
import { loadImagingReportDocuments } from "@/lib/imaging-reports/documents";
import { ImagingReportUpload } from "@/components/imaging-report-upload";
import { AiImagingSummary } from "@/components/ai-imaging-summary";

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
 * Patient-facing list of uploaded imaging/radiology report documents —
 * mirrors EcgReportDocuments and ResultDocuments in structure and
 * discipline. Before this component existed, ImagingReportUpload was a real,
 * working, tested component that no page anywhere ever mounted — a patient
 * had a working upload action and a real storage bucket, but genuinely no
 * way to reach either. This is the first patient-facing surface for imaging
 * reports on the platform.
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
    <Card>
      <CardHeader>
        <CardTitle>Imaging results</CardTitle>
        <CardDescription>
          X-ray, ultrasound, CT, MRI, or other scan reports on your record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No imaging reports uploaded yet.
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
                    {doc.originalFilename ?? "Imaging report"}
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
                    <AiImagingSummary
                      status={doc.aiSummaryStatus}
                      impressionText={doc.aiImpressionText}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <ImagingReportUpload label="Upload an imaging report" />
        </div>
      </CardContent>
    </Card>
  );
}
