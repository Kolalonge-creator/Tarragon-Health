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
 * §13 — "care gap tracking"), as counts only.
 *
 * The per-member list this used to render was removed on 2026-07-29 under I9,
 * along with the RLS access that made it possible. The original justification
 * — that org-staff already had direct access to the underlying tables, so
 * showing the list exposed nothing new — was true and was the actual problem.
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
        <p className="text-sm text-charcoal-ink/60">
          Each gap is worked by the member&apos;s own care team. Tarragon contacts them directly.
        </p>
      </CardContent>
    </Card>
  );
}
