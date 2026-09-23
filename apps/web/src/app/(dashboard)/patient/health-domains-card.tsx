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
import { HealthDomainArt } from "@/app/(dashboard)/patient/health-domain-art";

const GROUP_META: Record<HealthDomainGroup, { label: string; blurb: string }> = {
  energy: {
    label: "Energy, day to day",
    blurb: "The everyday drivers of how you feel right now.",
  },
  future_health: {
    label: "Future health",
    blurb: "Where your longer-term risk is heading, so you can act early.",
  },
};

/** Matches (sections)/page.tsx's own CardSkeleton treatment — this card
 * can't use that page's <Suspense> wrapper (it's a client component doing
 * its own useQuery fetching, not a Suspense-compatible server component),
 * so it renders its own equivalent placeholder rather than nothing at all
 * while its three queries are in flight. */
function Skeleton() {
  return <div aria-hidden className="h-56 animate-pulse rounded-2xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10" />;
}

function DomainTile({ domain }: { domain: HealthDomainView }) {
  const badge =
    domain.status === "good"
      ? { variant: "green" as const, label: "Good" }
      : domain.status === "attention"
        ? { variant: "amber" as const, label: "Needs attention" }
        : null;

  return (
    <div className="flex gap-3 rounded-xl border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-4">
      <HealthDomainArt domainKey={domain.key} className="h-10 w-10 shrink-0" />
      <div className="min-w-0">
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
    </div>
  );
}

function GroupSection({ group, domains }: { group: HealthDomainGroup; domains: HealthDomainView[] }) {
  const meta = GROUP_META[group];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
        {meta.label}
      </p>
      <p className="mb-2 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{meta.blurb}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {domains.map((domain) => (
          <DomainTile key={domain.key} domain={domain} />
        ))}
      </div>
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
 * Self-hides for a patient with no signal that maps into any of the 9
 * domains — checked against the BUILT domains' own status, not just raw
 * data presence, so a patient whose only data is a signal this taxonomy
 * doesn't cover (e.g. an adherence score, a kidney/liver lab result) also
 * gets a quiet skip rather than nine "not tracked yet" tiles.
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

  if (riskLoading || biomarkerLoading || sleepLoading) return <Skeleton />;

  const domains = buildHealthDomains({
    riskSignals: riskSignals ?? [],
    biomarkerCategories: biomarkerCategories ?? [],
    sleepSummary: sleepSummary ?? null,
    canViewReproductive,
  });

  if (domains.every((d) => d.status === "no_data")) return null;

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
        <GroupSection group="energy" domains={energy} />
        <GroupSection group="future_health" domains={futureHealth} />
      </CardContent>
    </Card>
  );
}
