"use client";

import {
  useProviderScorecard,
  useMyOpenProviderInterventions,
  useAcknowledgeProviderIntervention,
  type ProviderQualityMetricEntry,
} from "@/lib/queries/provider-quality";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_BADGE: Record<
  ProviderQualityMetricEntry["status"],
  { label: string; tone: "green" | "amber" | "red" | "grey" }
> = {
  on_target: { label: "On target", tone: "green" },
  watch: { label: "Watch", tone: "amber" },
  below_target: { label: "Below target", tone: "red" },
  insufficient_volume: { label: "Not enough volume yet", tone: "grey" },
  no_data: { label: "No data this period", tone: "grey" },
};

const METRIC_LABEL: Record<string, string> = {
  appointment_completion_rate: "Appointments completed",
  provider_cancellation_rate: "Cancelled by you",
  patient_no_show_rate: "Patient no-shows",
  appointment_punctuality_rate: "Started on time",
  alert_response_minutes: "Avg. alert response time",
  escalation_resolution_hours: "Avg. escalation resolution time",
  alert_sla_met_rate: "Alert SLA met",
  encounter_note_completion_rate: "Notes finalized",
  referral_documentation_rate: "Referrals documented",
  result_acknowledgement_rate: "Results acknowledged",
  experience_punctuality: "Punctuality",
  experience_communication: "Communication",
  experience_professionalism: "Professionalism",
  experience_overall: "Overall experience",
  abnormal_result_response_hours: "Abnormal-result response time",
  follow_up_completion_rate: "Follow-up completion",
  care_gap_resolution_rate: "Care-gap resolution",
  guideline_adherence_rate: "Guideline adherence",
};

function formatValue(entry: ProviderQualityMetricEntry): string {
  if (entry.value === undefined) return "—";
  if (entry.unit === "percent") return `${entry.value}%`;
  if (entry.unit === "minutes") return `${entry.value} min`;
  if (entry.unit === "hours") return `${entry.value} hrs`;
  if (entry.unit === "rating_1_5") return `${entry.value}/5`;
  return String(entry.value);
}

function MetricRow({ entry }: { entry: ProviderQualityMetricEntry }) {
  const badge = STATUS_BADGE[entry.status];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-charcoal-ink/5 py-2.5 last:border-0">
      <div>
        <p className="text-sm text-charcoal-ink">{METRIC_LABEL[entry.metric] ?? entry.metric}</p>
        <p className="text-xs text-charcoal-ink/50">
          {entry.denominator} {entry.denominator === 1 ? "case" : "cases"} this period
          {entry.status !== "insufficient_volume" && entry.target !== null
            ? ` · target ${entry.target}${entry.unit === "percent" ? "%" : ""}`
            : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-heading text-base font-semibold text-charcoal-ink">
          {formatValue(entry)}
        </span>
        <Badge variant={badge.tone}>{badge.label}</Badge>
      </div>
    </div>
  );
}

function DomainCard({
  title,
  description,
  entries,
}: {
  title: string;
  description?: string;
  entries: ProviderQualityMetricEntry[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-charcoal-ink/50">Nothing to report yet this period.</p>
        ) : (
          entries.map((e) => <MetricRow key={e.metric} entry={e} />)
        )}
      </CardContent>
    </Card>
  );
}

/**
 * §29.2 provider scorecard — Care Team's own view of `public.provider_scorecard`.
 * Deliberately a SEPARATE section from the activity-feed tiles above it
 * (`MyPerformanceView` / `my_provider_performance`): this one measures
 * against a target with a denominator on every figure, that one just counts.
 * §29.10 governs the shape here — domains never combine into one number, and
 * a metric below its minimum sample size shows no rate at all, only "not
 * enough volume yet".
 */
export function ProviderScorecardView() {
  const { data, isLoading, isError } = useProviderScorecard();

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading your scorecard…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-red-600">Could not load your scorecard.</p>;
  }
  if (!data.domains || !data.provider) {
    // No active clinical_staff record on this account — nothing to show,
    // same empty-state posture as MyPerformanceView above.
    return null;
  }

  const { domains, credentials, clinical_quality_note } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Your scorecard</h2>
        <p className="text-sm text-charcoal-ink/60">
          Measured against a target, not against your colleagues. A quieter caseload never reads
          as worse here. Anything with too few cases this period to be a fair number says so
          instead of showing a rate.
        </p>
      </div>

      {credentials && (credentials.work_restricted || !credentials.attestation_current) ? (
        <Card variant="soft" className="border border-amber-200 bg-amber-50">
          <CardContent className="space-y-1 py-4 text-sm text-amber-900">
            {credentials.work_restricted ? (
              <p>
                New appointments can&apos;t currently be booked with you
                {credentials.restriction_stage ? ` (${credentials.restriction_stage.replace("_", " ")})` : ""}
                . Your existing patients and records are unaffected. Contact your administrator to
                resolve this.
              </p>
            ) : null}
            {!credentials.attestation_current ? (
              <p>Your annual clinical attestation is due or overdue. See Settings.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DomainCard
          title="Operational"
          description="Punctuality, cancellations, no-shows, response time, appointment completion."
          entries={domains.operational}
        />
        <DomainCard
          title="Documentation"
          description="Notes completed, referrals documented, results acknowledged."
          entries={domains.documentation}
        />
        <DomainCard
          title="Patient experience"
          description="Structured feedback patients left after a visit."
          entries={domains.patient_experience}
        />
        <DomainCard
          title="Clinical quality"
          description={clinical_quality_note}
          entries={domains.clinical_quality}
        />
      </div>

      <Card variant="soft">
        <CardContent className="py-4 text-sm text-charcoal-ink/70">
          <span className="font-heading text-xl font-semibold text-charcoal-ink">
            {data.open_complaints ?? 0}
          </span>{" "}
          open complaint{(data.open_complaints ?? 0) === 1 ? "" : "s"} on your file.
        </CardContent>
      </Card>

      <ProviderInterventionsList />
    </div>
  );
}

/**
 * §29.8 — interventions on the caller's own professional development file.
 * Opened/typed by an admin or Clinical Director (never automatically — see
 * the provider_interventions migration); the one thing the subject can do
 * here is confirm they've seen it.
 */
function ProviderInterventionsList() {
  const { data: interventions, isLoading } = useMyOpenProviderInterventions();
  const acknowledge = useAcknowledgeProviderIntervention();

  if (isLoading || !interventions || interventions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">On your professional development file</CardTitle>
        <CardDescription>
          Recorded by your administrator or Clinical Director, with a rationale you can read
          below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {interventions.map((item) => (
          <div key={item.id} className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium capitalize text-charcoal-ink">
                {item.intervention_type.replace("_", " ")}
              </span>
              <Badge variant={item.status === "in_progress" ? "blue" : "amber"}>
                {item.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-charcoal-ink/70">{item.rationale}</p>
            {item.agreed_actions ? (
              <p className="mt-1 text-xs text-charcoal-ink/50">Agreed actions: {item.agreed_actions}</p>
            ) : null}
            {item.provider_acknowledged_at ? (
              <p className="mt-2 text-xs text-charcoal-ink/40">Acknowledged</p>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(item.id)}
              >
                {acknowledge.isPending ? "Confirming…" : "I've seen this"}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
