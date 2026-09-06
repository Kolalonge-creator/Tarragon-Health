"use client";

import { useMyProviderPerformance } from "@/lib/queries/provider-performance";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatNumber } from "@/lib/analytics/format";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ProviderScorecardView } from "./provider-scorecard-view";

export function MyPerformanceView() {
  const { data, isLoading, isError } = useMyProviderPerformance();

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-red-600">Could not load your performance data.</p>;
  }
  if (data.patients_assigned === 0 && data.escalations_reviewed === 0 && data.consultations_completed === 0) {
    // Also the shape returned for a caller with no active clinical_staff row
    // (my_provider_performance returns {}, which the schema's defaults fill
    // with zeros) — one honest empty state covers both cases.
    return (
      <Card>
        <CardContent className="py-6 text-sm text-charcoal-ink/60">
          Nothing to show yet. This fills in as you review cases, confirm medications, and see
          patients.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={SEMANTIC_ICON.parentCare}
          label="Patients assigned"
          value={formatNumber(data.patients_assigned)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          label="Pending results"
          value={formatNumber(data.pending_results)}
          delta={{
            text: data.pending_results > 0 ? "On your patients" : "None right now",
            direction: data.pending_results > 0 ? "down" : "up",
          }}
        />
        <StatTile
          icon={SEMANTIC_ICON.carePlan}
          label="Escalations reviewed"
          value={formatNumber(data.escalations_reviewed)}
        />
        <StatTile
          icon={SEMANTIC_ICON.medication}
          label="Medication reviews completed"
          value={formatNumber(data.reviews_completed)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consultations</CardTitle>
          <CardDescription>All-time count from your appointment record.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-charcoal-ink/50">Completed</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(data.consultations_completed)}
            </p>
          </div>
          <div>
            <p className="text-xs text-charcoal-ink/50">Cancelled / no-show</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(data.consultations_cancelled)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Responsiveness</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-charcoal-ink/50">Avg. time to acknowledge an alert</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(data.avg_ack_minutes)} min
            </p>
          </div>
          <div>
            <p className="text-xs text-charcoal-ink/50">Avg. time to resolve an escalation</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(data.avg_resolution_hours)} hrs
            </p>
          </div>
          <div>
            <p className="text-xs text-charcoal-ink/50">SLA met</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {data.sla_met_pct === null ? "—" : `${data.sla_met_pct}%`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referrals</CardTitle>
          <CardDescription>
            {data.referrals_partial_attribution
              ? "Referrals you personally set the urgency/summary on. A referral the system raised automatically (e.g. from an abnormal result) isn't attributed to any one doctor here, so this is a floor, not a full count."
              : undefined}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-xl font-semibold text-charcoal-ink">
            {formatNumber(data.referrals_made)}
          </p>
        </CardContent>
      </Card>

      <Card variant="soft">
        <CardContent className="space-y-1.5 py-4 text-xs text-charcoal-ink/60">
          <p>
            Revenue isn&apos;t shown: Tarragon employs its care-team doctors on salary or
            per-caseload terms, not fee-per-service, so there is no per-consultation revenue
            figure that would mean anything here.
          </p>
          {!data.patient_feedback_available ? (
            <p>
              Patient feedback isn&apos;t shown yet: none of your visits have an attributed rating
              on file this period.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ProviderScorecardView />
    </div>
  );
}
