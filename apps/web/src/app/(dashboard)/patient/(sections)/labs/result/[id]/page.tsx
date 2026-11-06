import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import { loadEarlierResultDocuments, loadResultDocument } from "@/lib/lab-results/documents";
import { AiResultSummary } from "@/app/(dashboard)/patient/ai-result-summary";

export const metadata = { title: "Your result" };
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

const BACK = { href: "/patient/labs#result-documents", label: "Labs" } as const;

/**
 * One result, on its own page (patient dashboard 2.0, spec 9.4, gap P10). In order: the original report as it came from the
 * laboratory; the doctor's explanation, or a plain "not reviewed yet"; the automated reader's summary, labelled as not a
 * medical opinion and shown only until a doctor has explained the result (the same rule as the list on /patient/labs); the
 * next steps; and the earlier results of the same type.
 *
 * Nothing here is new clinical content: every line is a field the list already shows. Extracted values are deliberately not
 * listed: the document itself is the record, and only a doctor's explanation interprets it.
 */
export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { subjectId, acting } = await getPatientDashboardContext();
  const supabase = await createClient();
  const loaded = await loadResultDocument(supabase, subjectId, id);

  if (!loaded.ok) {
    return (
      <div className="space-y-4">
        <PageHeader backTo={BACK} title="Your result" icon={SEMANTIC_ICON.labs} />
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          We could not load this result just now. Please try again in a moment.
        </p>
      </div>
    );
  }
  const doc = loaded.doc;
  if (!doc) {
    return (
      <div className="space-y-4">
        <PageHeader backTo={BACK} title="Your result" icon={SEMANTIC_ICON.labs} />
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          We could not find this result on the record. It may have been replaced by a corrected copy.
        </p>
      </div>
    );
  }

  const title = doc.testCode ? testCodeLabel(doc.testCode) : (doc.originalFilename ?? "Result");
  const interpreted = Boolean(doc.interpretationSentAt && doc.patientInterpretation);
  const earlier = doc.testCode ? await loadEarlierResultDocuments(supabase, subjectId, doc.testCode, doc.createdAt) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={BACK}
        title={title}
        icon={SEMANTIC_ICON.labs}
        description={`${doc.source === "patient" ? "You uploaded this" : "Uploaded by your care team"} on ${formatDate(doc.createdAt)}.`}
      />

      {doc.supersededByDocumentId && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          A corrected copy of this result was added later.{" "}
          <Link href={`/patient/labs/result/${doc.supersededByDocumentId}`} className="font-medium underline">
            See the corrected result
          </Link>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>The original report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {doc.signedUrl ? (
            <a
              href={doc.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-green hover:underline dark:text-brand-green-bright"
            >
              Open {doc.isPdf ? "the PDF" : "the photo"} ({doc.originalFilename ?? "result"})
            </a>
          ) : (
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">
              The file could not be opened just now. Reload the page to try again.
            </p>
          )}
          {doc.note && <p className="text-charcoal-ink/70 dark:text-night-ink/70">Note sent with it: {doc.note}</p>}
          {doc.supersedesDocumentId && (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              This corrects an earlier copy.{" "}
              <Link href={`/patient/labs/result/${doc.supersedesDocumentId}`} className="underline">
                See the earlier copy
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The doctor&apos;s explanation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {interpreted ? (
            <>
              <p className="text-charcoal-ink dark:text-night-ink">{doc.patientInterpretation}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ReviewedResultLine reviewedBy={doc.reviewedBy} reviewedAt={doc.reviewedAt} />
                <a
                  href={`/api/patient/lab-result/${doc.id}/pdf`}
                  className="font-medium text-brand-green hover:underline dark:text-brand-green-bright"
                >
                  Download as PDF
                </a>
              </div>
            </>
          ) : (
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">
              A doctor has not reviewed this yet. Their explanation will appear here as soon as they have.
            </p>
          )}
        </CardContent>
      </Card>

      {/* The automated summary only while no doctor has explained the result, as on the list; the Discuss button books a
          consultation for whoever is signed in, so it is not offered while acting for someone else. */}
      {!interpreted && !acting && (
        <AiResultSummary status={doc.aiSummaryStatus} flaggedAnalytes={doc.aiFlaggedAnalytes} />
      )}

      {interpreted && doc.nextSteps && (
        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-charcoal-ink dark:text-night-ink">{doc.nextSteps}</CardContent>
        </Card>
      )}

      {doc.testCode && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier {title} results</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {earlier === null ? (
              <p className="text-charcoal-ink/70 dark:text-night-ink/70">We could not check for earlier results just now.</p>
            ) : earlier.length === 0 ? (
              <p className="text-charcoal-ink/70 dark:text-night-ink/70">This is the first one on your record.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {earlier.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                    <Link
                      href={`/patient/labs/result/${row.id}`}
                      className="font-medium text-brand-green hover:underline dark:text-brand-green-bright"
                    >
                      {formatDate(row.createdAt)}
                    </Link>
                    <Badge variant={row.interpreted ? "green" : "grey"}>
                      {row.interpreted ? "Explained by a doctor" : "Not reviewed yet"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
