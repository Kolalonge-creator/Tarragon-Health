"use client";

import { usePatientRiskSignals } from "@/lib/queries/health-score";
import { useBiomarkerCategories } from "@/lib/queries/biomarker-categories";
import { useSleepSummary } from "@/lib/queries/wearable-sleep";
import {
  buildHealthDomains,
  type HealthDomainGroup,
  type HealthDomainView,
} from "@/lib/health-domains/domains";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const GROUP_LABEL: Record<HealthDomainGroup, string> = {
  energy: "Energy, day to day",
  future_health: "Future health",
};

const GROUP_BLURB: Record<HealthDomainGroup, string> = {
  energy: "The everyday drivers of how you feel right now.",
  future_health: "Where your longer-term risk is heading, so you can act early.",
};

function DomainTile({ domain }: { domain: HealthDomainView }) {
  const badge =
    domain.status === "good"
      ? { variant: "green" as const, label: "Good" }
      : domain.status === "attention"
        ? { variant: "amber" as const, label: "Needs attention" }
        : null;

  return (
    <div className="rounded-xl border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{domain.label}</p>
        {badge ? (
          <Badge variant={badge.variant}>{badge.label}</Badge>
        ) : (
          <Badge variant="grey">Not tracked yet</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{domain.blurb}</p>
      <p className="mt-1.5 text-xs text-charcoal-ink/70 dark:text-night-ink/70">{domain.narrative}</p>
    </div>
  );
}

/**
 * Groups signals Tarragon already computes (patient_risk_scores, reviewed
 * lab categories, synced sleep) into 9 named domains across two horizons:
 * today's energy and longer-term organ-system risk. See
 * lib/health-domains/domains.ts for the rollup rule (deterministic, no
 * LLM call — same discipline as lib/ai-coach/composed-surfaces.ts).
 *
 * Self-hides for a brand-new patient with nothing logged anywhere yet,
 * same convention as RiskSignalsCard/BiomarkerCategoriesCard — showing
 * nine "nothing logged yet" tiles on a first-ever visit is clutter, not
 * orientation.
 */
export function HealthDomainsCard({
  patientId,
  canViewReproductive,
}: {
  patientId: string;
  /** True only when the current viewer IS the patient. Never inferred for a
   * caregiver/supporter viewing someone else's record — pass `!acting` from
   * the page's dashboard context, never a guess. */
  canViewReproductive: boolean;
}) {
  const { data: riskSignals, isLoading: riskLoading } = usePatientRiskSignals(patientId);
  const { data: biomarkerCategories, isLoading: biomarkerLoading } = useBiomarkerCategories(patientId);
  const { data: sleepSummary, isLoading: sleepLoading } = useSleepSummary(patientId);

  if (riskLoading || biomarkerLoading || sleepLoading) return null;

  const hasAnyData =
    (riskSignals?.length ?? 0) > 0 ||
    (biomarkerCategories?.some((c) => c.reviewedCount > 0) ?? false) ||
    (sleepSummary?.nightsInWindow ?? 0) > 0;
  if (!hasAnyData) return null;

  const domains = buildHealthDomains({
    riskSignals: riskSignals ?? [],
    biomarkerCategories: biomarkerCategories ?? [],
    sleepSummary: sleepSummary ?? null,
    canViewReproductive,
  });

  const energy = domains.filter((d) => d.group === "energy");
  const futureHealth = domains.filter((d) => d.group === "future_health");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.escalation
            className="h-5 w-5 text-deep-forest dark:text-brand-green-bright"
            strokeWidth={2}
            aria-hidden
          />
          Your health, by area
        </CardTitle>
        <CardDescription>
          The same readings and results you already track, grouped by what they mean for you:
          today&apos;s energy, and the health you&apos;re protecting for later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
            {GROUP_LABEL.energy}
          </p>
          <p className="mb-2 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{GROUP_BLURB.energy}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {energy.map((domain) => (
              <DomainTile key={domain.key} domain={domain} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
            {GROUP_LABEL.future_health}
          </p>
          <p className="mb-2 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            {GROUP_BLURB.future_health}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {futureHealth.map((domain) => (
              <DomainTile key={domain.key} domain={domain} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
