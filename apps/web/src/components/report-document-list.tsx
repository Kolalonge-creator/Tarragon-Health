import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Common shape every result-document type (lab result, ECG, imaging report)
 * exposes — the fields ReportDocumentList itself needs to render the
 * card/list/badge/signed-URL-link chrome shared by ResultDocuments,
 * EcgReportDocuments and ImagingReportDocuments. Callers pass their own
 * richer view type (e.g. ResultDocumentView) as `T`; `renderReviewed`/
 * `renderPending` receive the full `T`, not just this subset.
 */
export interface ReportDocumentFields {
  id: string;
  originalFilename: string | null;
  source: string;
  note: string | null;
  createdAt: string;
  signedUrl: string | null;
  isPdf: boolean;
}

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
 * Shared card/list/badge/signed-URL-link/reviewed-block structure for a
 * patient-facing result-document list — factored out of ResultDocuments,
 * EcgReportDocuments and ImagingReportDocuments, which used to each carry a
 * near-verbatim copy of this layout. Per-document content that genuinely
 * differs between document types (what a "reviewed" vs "not yet reviewed"
 * card shows, which AI-summary component runs) is supplied by the caller via
 * `renderReviewed`/`renderPending`; the upload form and any other
 * document-type-specific footer content (e.g. ResultDocuments' download
 * picker) via `footer`.
 *
 * `isReviewed` decides which of `renderReviewed`/`renderPending` a document
 * gets. `badgeReviewed` decides the badge's own colour/label independently —
 * defaulting to `isReviewed` (true for ECG/imaging, where both conditions
 * are simply `reviewedAt`), but overridable for ResultDocuments, whose badge
 * has always reflected `interpretationSentAt` alone while the content block
 * has always required both `interpretationSentAt` AND `patientInterpretation`
 * — a pre-existing distinction this component preserves rather than papers
 * over.
 */
export function ReportDocumentList<T extends ReportDocumentFields>({
  title,
  description,
  emptyText,
  fallbackFilename,
  groups,
  isReviewed,
  badgeReviewed = isReviewed,
  reviewedLabel = "Reviewed",
  pendingLabel = "Awaiting review",
  renderReviewed,
  renderPending,
  footer,
}: {
  title: string;
  description: ReactNode;
  emptyText: string;
  /** Shown in place of a document's filename when it has none. */
  fallbackFilename: string;
  /** Pre-grouped documents, most-recently-relevant group first. A group
   * header only renders when there's more than one group — pass a single
   * `{ label: "", documents }` entry for an ungrouped list. */
  groups: { label: string; documents: T[] }[];
  isReviewed: (doc: T) => boolean;
  badgeReviewed?: (doc: T) => boolean;
  reviewedLabel?: string;
  pendingLabel?: string;
  renderReviewed: (doc: T) => ReactNode;
  renderPending: (doc: T) => ReactNode;
  /** Rendered after the document list regardless of whether it's empty —
   * the upload form, and (for ResultDocuments) the multi-result download
   * picker. */
  footer?: ReactNode;
}) {
  const totalDocuments = groups.reduce((sum, group) => sum + group.documents.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalDocuments === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{emptyText}</p>
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
                          {doc.originalFilename ?? fallbackFilename}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={badgeReviewed(doc) ? "green" : "amber"}>
                            {badgeReviewed(doc) ? reviewedLabel : pendingLabel}
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
                      {isReviewed(doc) ? renderReviewed(doc) : renderPending(doc)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
