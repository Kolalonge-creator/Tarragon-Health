"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { useOutcomeReports } from "@/lib/queries/outcome-reports";

type ReportSnapshot = {
  analytics?: {
    screening_overdue_rate_percent?: number;
    abnormal_findings_count?: number;
  };
};

/**
 * Renewal-facing "outcome evidence" — screening-compliance trend +
 * abnormal-catch-rate (measured counts only; S-14 hides the modelled saving), feeding off outcome_reports
 * history (docs/Tarragon_Health_Master_Operating_Plan_v4.md §13's "reporting
 * for renewal conversations", mirrored here for corporate).
 */
export function OutcomeEvidenceSummary({
  organisationId,
}: {
  organisationId: string;
}) {
  const reports = useOutcomeReports(organisationId);

  const snapshots = (reports.data ?? [])
    .map((r) => r.snapshot as ReportSnapshot | null)
    .filter((s): s is ReportSnapshot => s !== null)
    .slice(0, 2);

  const latest = snapshots[0]?.analytics?.screening_overdue_rate_percent;
  const previous = snapshots[1]?.analytics?.screening_overdue_rate_percent;
  const hasTrend = latest !== undefined && previous !== undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Outcome evidence
        </CardTitle>
        <CardDescription>For renewal conversations: quotable, frozen-per-report figures.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasTrend ? (
          <StatTile
            icon={SEMANTIC_ICON.booking}
            label="Screening compliance trend"
            value={`${(100 - latest!).toFixed(0)}%`}
            unit="compliant"
            delta={{
              text: latest! < previous! ? "Improving vs. prior report" : "Declining vs. prior report",
              direction: latest! < previous! ? "up" : "down",
            }}
          />
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            Not enough report history yet. Generate at least 2 outcome reports to see a compliance trend.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
