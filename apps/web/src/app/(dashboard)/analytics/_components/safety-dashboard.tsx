"use client";

import { AlertOctagon, Clock, HeartPulse, Pill, ShieldAlert, Siren, Sparkles } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import {
  useAlertBurden,
  useAlertQuality,
  useSafetyDashboardSummary,
} from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";

const SEVERITY_LABEL: Record<string, string> = {
  "0": "Info",
  "1": "Low",
  "2": "Moderate",
  "3": "High",
  "4": "Critical",
};

/**
 * Patient Safety dashboard (docs spec §89.14). The six headline counts are
 * exactly the spec's own mockup (critical alerts / open safety events /
 * near misses / overdue actions / AI escalations / medication incidents),
 * sourced from analytics_safety_dashboard_summary() — new for this gap-
 * closure pass. Per-clinician burden and alert quality below reuse
 * analytics_alert_burden()/analytics_alert_quality(), which were already
 * live but had no UI anywhere before this page.
 */
export function SafetyDashboard() {
  const { data: summary } = useSafetyDashboardSummary();
  const burden = useAlertBurden();
  const quality = useAlertQuality();

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Patient safety signal, org-wide — clinician alerts, filed incidents/near-misses, and
        safeguarding concerns in one view.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          icon={Siren}
          label="Critical alerts"
          value={formatNumber(summary?.critical_alerts ?? 0)}
          tintClassName="bg-red-100"
          iconClassName="text-red-700"
        />
        <StatTile
          icon={ShieldAlert}
          label="Open safety events"
          value={formatNumber(summary?.open_safety_events ?? 0)}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
        />
        <StatTile
          icon={AlertOctagon}
          label="Near misses"
          value={formatNumber(summary?.near_misses ?? 0)}
          tintClassName="bg-blue-100"
          iconClassName="text-blue-700"
        />
        <StatTile
          icon={Clock}
          label="Overdue actions"
          value={formatNumber(summary?.overdue_actions ?? 0)}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
        />
        <StatTile
          icon={Sparkles}
          label="AI escalations"
          value={formatNumber(summary?.ai_escalations ?? 0)}
        />
        <StatTile
          icon={Pill}
          label="Medication incidents"
          value={formatNumber(summary?.medication_incidents ?? 0)}
          tintClassName="bg-red-100"
          iconClassName="text-red-700"
        />
      </div>

      {(summary?.open_safeguarding_concerns ?? 0) > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <HeartPulse className="h-4 w-4" strokeWidth={2} />
          {summary?.open_safeguarding_concerns} open safeguarding{" "}
          {summary?.open_safeguarding_concerns === 1 ? "concern" : "concerns"} — visible to Tier
          3+/Clinical Director only.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Alert burden by clinician"
          description="Open alerts currently owned, and their average age."
        >
          {burden.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (burden.data?.per_clinician ?? []).length === 0 ? (
            <CenterNote>No clinician currently owns an open alert.</CenterNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Clinician</th>
                    <th className="py-2 pr-4 font-medium">Tier</th>
                    <th className="py-2 pr-4 font-medium">Open</th>
                    <th className="py-2 pr-4 font-medium">Urgent+</th>
                    <th className="py-2 font-medium">Avg age</th>
                  </tr>
                </thead>
                <tbody>
                  {burden.data!.per_clinician.map((row) => (
                    <tr key={row.clinical_staff_id} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink/80">{row.full_name}</td>
                      <td className="py-2 pr-4 capitalize text-charcoal-ink/60">
                        {row.doctor_tier?.replace(/_/g, " ") ?? "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-charcoal-ink">{row.open_owned}</td>
                      <td className="py-2 pr-4 tabular-nums text-charcoal-ink">
                        {row.open_owned_urgent_plus}
                      </td>
                      <td className="py-2 tabular-nums text-charcoal-ink/70">
                        {row.avg_age_hours != null ? `${row.avg_age_hours}h` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(burden.data?.unassigned_important_open ?? 0) > 0 && (
            <p className="mt-3 text-xs font-medium text-red-700">
              {burden.data?.unassigned_important_open} unassigned open alert(s) at urgent severity
              or above.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Alert quality (last 30 days)"
          description="How alerts resolve, not just how many fire."
        >
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            {[
              ["Total alerts", formatNumber(quality.data?.total ?? 0)],
              ["Avg time to ack", quality.data?.avg_ack_minutes != null ? `${quality.data.avg_ack_minutes}m` : "—"],
              ["Avg time to resolve", quality.data?.avg_resolution_hours != null ? `${quality.data.avg_resolution_hours}h` : "—"],
              ["Escalation rate", formatPercent(quality.data?.escalation_rate_pct ?? 0)],
              ["Duplicate rate", formatPercent(quality.data?.duplicate_rate_pct ?? 0)],
              ["False-positive rate", formatPercent(quality.data?.false_positive_rate_pct ?? 0)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-md border border-charcoal-ink/10 px-3 py-2"
              >
                <span className="text-charcoal-ink/60">{label}</span>
                <span className="font-medium tabular-nums text-charcoal-ink">{value}</span>
              </div>
            ))}
          </dl>
          <MiniBarList
            items={Object.entries(quality.data?.by_severity ?? {}).map(([severity, count]) => ({
              label: SEVERITY_LABEL[severity] ?? severity,
              value: count,
            }))}
            emptyLabel="No alerts in the last 30 days."
          />
        </SectionCard>
      </div>
    </div>
  );
}
