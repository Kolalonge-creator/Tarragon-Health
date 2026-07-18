import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { CareGapSummary, CareGapType } from "@/lib/care-gaps/load-care-gaps";

const GAP_TYPE_LABEL: Record<CareGapType, string> = {
  overdue_screening: "Overdue screenings",
  stale_monitoring: "Stale chronic monitoring",
  unactioned_abnormal: "Unactioned abnormal results",
};

/**
 * Care-gap closure tracked to completion (docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §13 — "care gap tracking"). Per-member drill-down is shown here for
 * org-staff — this is NOT new data exposure: org-staff already have RLS
 * access to screening_schedules/care_plans directly. Only the top-level
 * cohort percentages on the rest of the dashboard stay anonymised, matching
 * the "anonymised risk dashboard" marketing promise for aggregate framing.
 */
export function CareGapPanel({ summary }: { summary: CareGapSummary | null }) {
  if (!summary) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.booking className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Care gaps
        </CardTitle>
        <CardDescription>
          Members with an overdue screening, stale chronic monitoring, or an abnormal result that hasn&apos;t
          been actioned yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile icon={SEMANTIC_ICON.booking} label="Open gaps" value={String(summary.totalOpen)} />
          {(Object.keys(GAP_TYPE_LABEL) as CareGapType[]).map((type) => (
            <StatTile
              key={type}
              icon={SEMANTIC_ICON.booking}
              label={GAP_TYPE_LABEL[type]}
              value={String(summary.byType[type])}
            />
          ))}
        </div>
        <p className="text-sm text-charcoal-ink/70">
          Closed in the last 90 days: <span className="font-medium text-deep-forest">{summary.closedLast90Days}</span>
        </p>
        {summary.rows.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-charcoal-ink/70 hover:text-charcoal-ink">
              View open gaps ({summary.rows.length})
            </summary>
            <ul className="mt-2 max-h-72 divide-y divide-charcoal-ink/10 overflow-auto rounded-md border border-charcoal-ink/10">
              {summary.rows.map((row, idx) => (
                <li key={`${row.patientId}-${row.gapType}-${idx}`} className="flex items-center justify-between gap-2 p-2">
                  <span className="text-charcoal-ink/80">
                    <span className="font-medium">{row.patientNumber ?? "Unnumbered member"}</span> ·{" "}
                    {GAP_TYPE_LABEL[row.gapType]} — {row.conditionOrType}
                  </span>
                  <span className="text-xs text-charcoal-ink/50">{new Date(row.openedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
