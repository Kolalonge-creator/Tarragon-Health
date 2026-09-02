"use client";

import { CalendarClock, Headphones, ShieldCheck, Timer } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import {
  useAlertQuality,
  useAppointmentCapacity,
  useReferralTurnaround,
  useSupportResponseTime,
} from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function specialtyLabel(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Operations & Command Centre §96.8 — composes appointment capacity, clinical
 * alert response quality, specialist-referral turnaround and support
 * first-response time into one service-levels view.
 */
export function ServiceLevelsDashboard() {
  const appointments = useAppointmentCapacity();
  const alerts = useAlertQuality();
  const referrals = useReferralTurnaround();
  const support = useSupportResponseTime();

  const a = appointments.data;
  const q = alerts.data;
  const r = referrals.data ?? [];
  const sup = support.data;

  const byCategory = Object.entries(q?.by_category ?? {}).map(([category, count]) => ({
    label: category,
    value: count,
  }));
  const bySeverity = Object.entries(q?.by_severity ?? {}).map(([severity, count]) => ({
    label: `Severity ${severity}`,
    value: count,
  }));

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Lab turnaround and prescription fulfilment aren&rsquo;t shown — self-arranged fulfilment
        means Tarragon can&rsquo;t reliably observe when a lab result or prescription is actually
        completed off-platform.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={ShieldCheck}
          label="Avg alert acknowledge time"
          value={q?.avg_ack_minutes == null ? "—" : formatNumber(q.avg_ack_minutes)}
          unit={q?.avg_ack_minutes == null ? undefined : "min"}
        />
        <StatTile
          icon={Timer}
          label="Avg alert resolution time"
          value={q?.avg_resolution_hours == null ? "—" : formatNumber(q.avg_resolution_hours)}
          unit={q?.avg_resolution_hours == null ? undefined : "hrs"}
        />
        <StatTile
          icon={CalendarClock}
          label="Avg referral booking time"
          value={
            r.length === 0
              ? "—"
              : formatNumber(
                  Math.round(
                    (r.reduce((sum, x) => sum + (x.avg_hours_to_booking ?? 0), 0) / r.length) * 10
                  ) / 10
                )
          }
          unit={r.length === 0 ? undefined : "hrs avg"}
        />
        <StatTile
          icon={Headphones}
          label="Avg support first response"
          value={sup?.avg_first_response_minutes == null ? "—" : formatNumber(sup.avg_first_response_minutes)}
          unit={sup?.avg_first_response_minutes == null ? undefined : "min"}
        />
      </div>

      <SectionCard
        title="Appointments by type (90d)"
        description="Volume, completion, cancellation and no-show rate per appointment type."
        actions={
          <ExportButton filename="appointment-capacity" rows={a?.by_appointment_type_90d ?? []} />
        }
      >
        {appointments.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (a?.by_appointment_type_90d ?? []).length === 0 ? (
          <CenterNote>No appointments in the last 90 days.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Completed</th>
                  <th className="py-2 pr-4 text-right font-medium">Cancelled</th>
                  <th className="py-2 pr-4 text-right font-medium">No-show</th>
                  <th className="py-2 pr-4 text-right font-medium">Cancel %</th>
                  <th className="py-2 text-right font-medium">No-show %</th>
                </tr>
              </thead>
              <tbody>
                {(a?.by_appointment_type_90d ?? []).map((row) => (
                  <tr key={row.appointment_type} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {specialtyLabel(row.appointment_type)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(row.total)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-brand-green">
                      {formatNumber(row.completed)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">
                      {formatNumber(row.cancelled)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-red-700">
                      {formatNumber(row.no_show)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">
                      {row.cancellation_rate_pct == null ? "—" : formatPercent(row.cancellation_rate_pct)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-charcoal-ink/60">
                      {row.no_show_rate_pct == null ? "—" : formatPercent(row.no_show_rate_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Waiting list by appointment type"
          description="Currently waiting, and average wait so far."
          actions={<ExportButton filename="appointment-waiting-list" rows={a?.waiting_list_by_type ?? []} />}
        >
          <MiniBarList
            items={(a?.waiting_list_by_type ?? []).map((w) => ({
              label: w.appointment_type,
              value: w.currently_waiting,
              display:
                w.avg_wait_hours == null
                  ? `${formatNumber(w.currently_waiting)}`
                  : `${formatNumber(w.currently_waiting)} · ${w.avg_wait_hours}h avg`,
            }))}
            emptyLabel="No one currently waiting."
          />
        </SectionCard>

        <SectionCard
          title="Clinical alerts by category"
          description={`${formatNumber(q?.total ?? 0)} alerts in the last 30 days.`}
          actions={<ExportButton filename="alerts-by-category" rows={byCategory} />}
        >
          {alerts.isLoading ? <CenterNote>Loading…</CenterNote> : <MiniBarList items={byCategory} />}
        </SectionCard>

        <SectionCard
          title="Clinical alerts by severity"
          actions={<ExportButton filename="alerts-by-severity" rows={bySeverity} />}
        >
          {alerts.isLoading ? <CenterNote>Loading…</CenterNote> : <MiniBarList items={bySeverity} />}
        </SectionCard>

        <SectionCard
          title="Alert quality"
          description="Escalation, duplicate and false-positive rates over the same window."
        >
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-charcoal-ink/60">Escalation rate</span>
              <span className="font-medium tabular-nums">
                {q?.escalation_rate_pct == null ? "—" : formatPercent(q.escalation_rate_pct)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-charcoal-ink/60">Duplicate rate</span>
              <span className="font-medium tabular-nums">
                {q?.duplicate_rate_pct == null ? "—" : formatPercent(q.duplicate_rate_pct)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-charcoal-ink/60">False-positive rate</span>
              <span className="font-medium tabular-nums">
                {q?.false_positive_rate_pct == null ? "—" : formatPercent(q.false_positive_rate_pct)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-charcoal-ink/60">Suppressed alerts</span>
              <span className="font-medium tabular-nums">{formatNumber(q?.suppressed_count ?? 0)}</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Referral turnaround by specialist type"
        description="90d volume plus time to booking and to a received treatment plan."
        actions={<ExportButton filename="referral-turnaround" rows={r} />}
      >
        {referrals.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : r.length === 0 ? (
          <CenterNote>No referrals in the last 90 days.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Specialty</th>
                  <th className="py-2 pr-4 text-right font-medium">Referrals (90d)</th>
                  <th className="py-2 pr-4 text-right font-medium">Avg hrs to booking</th>
                  <th className="py-2 pr-4 text-right font-medium">Median hrs to booking</th>
                  <th className="py-2 text-right font-medium">Avg hrs to treatment</th>
                </tr>
              </thead>
              <tbody>
                {r.map((row) => (
                  <tr key={row.specialist_type} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {specialtyLabel(row.specialist_type)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium">
                      {formatNumber(row.referrals_90d)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">
                      {row.avg_hours_to_booking == null ? "—" : `${row.avg_hours_to_booking}h`}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">
                      {row.median_hours_to_booking == null ? "—" : `${row.median_hours_to_booking}h`}
                    </td>
                    <td className="py-2 text-right tabular-nums text-charcoal-ink/60">
                      {row.avg_hours_to_treatment == null ? "—" : `${row.avg_hours_to_treatment}h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Support (in-app messages) first response"
        description="Gap between a patient's first message in a thread and the care team's first reply, last 90 days."
      >
        {support.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-charcoal-ink">
                {formatNumber(sup?.threads_90d ?? 0)}
              </p>
              <p className="text-xs text-charcoal-ink/60">threads started</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-charcoal-ink">
                {formatNumber(sup?.threads_with_reply ?? 0)}
              </p>
              <p className="text-xs text-charcoal-ink/60">threads with a reply</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-charcoal-ink">
                {sup?.avg_first_response_minutes == null ? "—" : `${formatNumber(sup.avg_first_response_minutes)} min`}
              </p>
              <p className="text-xs text-charcoal-ink/60">avg first response</p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
