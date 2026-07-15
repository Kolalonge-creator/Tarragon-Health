import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { RosterManager } from "./roster-manager";
import { OutcomeReportsPanel } from "./outcome-reports-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { CohortAnalyticsResponse } from "@tarragon/shared";

export default async function CorporatePage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health — cohort risk distribution"]}
      />
    );
  }

  const supabase = await createClient();
  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(supabase, profile.organisation_id),
    getContractPerformance(supabase, profile.organisation_id),
  ]);

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={[
          "Workforce health — cohort risk distribution (no staff enrolled yet, or ML service unavailable)",
        ]}
      >
        <div className="space-y-6">
          <ContractStatusCard performance={contractPerformance} />
          <RosterManager organisationId={profile.organisation_id} />
          <OutcomeReportsPanel organisationId={profile.organisation_id} />
        </div>
      </DashboardPlaceholder>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
        <p className="text-charcoal-ink/60">Corporate admin dashboard</p>
      </div>
      <ContractStatusCard performance={contractPerformance} />
      <RosterManager organisationId={profile.organisation_id} />
      <CohortSummary analytics={analytics} />
      <OutcomeReportsPanel organisationId={profile.organisation_id} />
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

function CohortSummary({ analytics }: { analytics: CohortAnalyticsResponse }) {
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
