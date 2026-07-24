import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { loadResultDocuments } from "@/lib/lab-results/documents";
import { UploadResultForm } from "./upload-result-form";

function sourceLabel(source: string): string {
  return source === "patient" ? "You uploaded this" : "Uploaded by your care team";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Patient-facing list of raw result documents (PDFs/images) on their record —
 * uploaded either by the patient themselves or by a Lab Liaison Officer /
 * clinician on their behalf. Each file opens via a short-lived signed URL
 * (never a public link). Always renders the upload form so a patient can add a
 * result they received directly.
 */
export async function ResultDocuments({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const documents = await loadResultDocuments(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result documents</CardTitle>
        <CardDescription>
          Lab result files on your record. Your care team reviews each one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No result documents yet.</p>
        ) : (
          <ul className="space-y-4">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="space-y-1 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {doc.originalFilename ?? "Result"}
                  </p>
                  <p className="shrink-0 text-xs text-charcoal-ink/50">{formatDate(doc.createdAt)}</p>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {sourceLabel(doc.source)}
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
                  <p className="text-xs text-charcoal-ink/50">File unavailable.</p>
                )}
                <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
              </li>
            ))}
          </ul>
        )}
        <UploadResultForm />
      </CardContent>
    </Card>
  );
}
