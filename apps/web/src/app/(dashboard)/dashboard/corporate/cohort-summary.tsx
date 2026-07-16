import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { CohortAnalyticsResponse } from "@tarragon/shared";

/**
 * Extracted from the corporate dashboard page so it can be reused verbatim
 * by the HMO dashboard (same cohort-analytics pipeline, org-agnostic —
 * see load-cohort-analytics.ts), rather than duplicating this rendering.
 */
export function CohortSummary({ analytics }: { analytics: CohortAnalyticsResponse }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Workforce overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={SEMANTIC_ICON.corporate} label="Cohort size" value={String(analytics.cohort_size)} />
            <StatTile icon={SEMANTIC_ICON.family} label="Average age" value={String(analytics.age_mean)} />
          </div>
          <p className="text-sm text-charcoal-ink/80">
            Sex: {analytics.sex_distribution.male ?? 0} male / {analytics.sex_distribution.female ?? 0}{" "}
            female
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Chronic condition prevalence
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {Object.entries(analytics.chronic_condition_prevalence_percent).map(([condition, pct]) => (
            <StatTile
              key={condition}
              icon={conditionIcon(condition)}
              label={humanize(condition)}
              value={String(pct)}
              unit="%"
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            CVD risk distribution
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {Object.entries(analytics.cvd_risk_level_distribution).map(([level, count]) => (
            <StatTile key={level} icon={SEMANTIC_ICON.bp} label={humanize(level)} value={String(count)} />
          ))}
          {analytics.cvd_risk_mean_percent !== null && (
            <StatTile
              icon={SEMANTIC_ICON.bp}
              label="Mean 10yr CVD risk"
              value={String(analytics.cvd_risk_mean_percent)}
              unit="%"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Screening compliance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={SEMANTIC_ICON.booking}
              label="Overdue rate"
              value={String(analytics.screening_overdue_rate_percent)}
              unit="%"
            />
            <StatTile
              icon={SEMANTIC_ICON.labs}
              label="Abnormal findings (anonymised)"
              value={String(analytics.abnormal_findings_count)}
            />
          </div>
          {analytics.top_abnormal_flags.length > 0 && (
            <ul className="list-inside list-disc pt-1 text-sm text-charcoal-ink/80">
              {analytics.top_abnormal_flags.map(({ flag, count }) => (
                <li key={flag}>
                  {flag}: {count}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function humanize(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function conditionIcon(condition: string) {
  if (condition === "hypertension") return SEMANTIC_ICON.bp;
  if (condition === "diabetes") return SEMANTIC_ICON.diabetes;
  return SEMANTIC_ICON.labs;
}
