import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { WellbeingCohortMetric } from "@/lib/corporate/load-wellbeing-cohort-metric";

const BAND_LABEL: Record<string, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  moderately_severe: "Moderately severe",
  severe: "Severe",
};

/**
 * Module 46 §46.14 workplace wellbeing — aggregate-only, cohort-level
 * mood/anxiety severity-band distribution (percentages, never a raw score,
 * never per-employee). Only rendered when the cohort clears the org's
 * min_cohort_size (see load-wellbeing-cohort-metric.ts's docstring); an
 * employer never receives an individual's mental-health information here or
 * anywhere else on this dashboard.
 */
export function WellbeingCohortSummary({ metric }: { metric: WellbeingCohortMetric }) {
  if (!metric) return null;

  const phq9Bands = Object.entries(metric.phq9);
  const gad7Bands = Object.entries(metric.gad7);
  if (phq9Bands.length === 0 && gad7Bands.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.mood className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Wellbeing (aggregate)
        </CardTitle>
        <CardDescription>
          {metric.respondedCount} of {metric.totalCount} enrolled people have completed a mental
          wellbeing check-in. Figures are workforce-level percentages only — Tarragon never shares
          an individual&apos;s mental health information with an employer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {phq9Bands.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
              Mood (PHQ-9)
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {phq9Bands.map(([band, pct]) => (
                <StatTile
                  key={band}
                  icon={SEMANTIC_ICON.mood}
                  label={BAND_LABEL[band] ?? band}
                  value={`${pct}%`}
                />
              ))}
            </div>
          </div>
        )}
        {gad7Bands.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
              Anxiety (GAD-7)
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {gad7Bands.map(([band, pct]) => (
                <StatTile
                  key={band}
                  icon={SEMANTIC_ICON.mood}
                  label={BAND_LABEL[band] ?? band}
                  value={`${pct}%`}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
