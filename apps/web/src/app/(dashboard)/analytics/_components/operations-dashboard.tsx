"use client";

import { AlertTriangle, Send, Stethoscope, Truck } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useDeliverability, useOperationsSummary } from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function OperationsDashboard() {
  const ops = useOperationsSummary();
  const deliver = useDeliverability();

  const o = ops.data;
  const d = deliver.data;
  const openAlerts = (o?.escalation_queue ?? []).reduce((sum, q) => sum + q.open, 0);
  const orders = o?.orders;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Stethoscope} label="Clinicians with panels" value={formatNumber(o?.clinician_load.length ?? 0)} />
        <StatTile icon={AlertTriangle} label={`Over ${o?.target_ratio ?? 120}:1 ratio`} value={formatNumber(o?.over_target ?? 0)} />
        <StatTile icon={AlertTriangle} label="Open escalation alerts" value={formatNumber(openAlerts)} />
        <StatTile icon={Send} label="Notification queue" value={formatNumber(d?.queue_depth ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Clinician workload"
          description={`Patients assigned per clinician. Target ratio ${o?.target_ratio ?? 120}:1.`}
          actions={<ExportButton filename="clinician-load" rows={o?.clinician_load ?? []} />}
        >
          {ops.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (o?.clinician_load ?? []).length === 0 ? (
            <CenterNote>No care-team assignments yet.</CenterNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Clinician</th>
                    <th className="py-2 pr-4 font-medium">Tier</th>
                    <th className="py-2 text-right font-medium">Patients</th>
                  </tr>
                </thead>
                <tbody>
                  {(o?.clinician_load ?? []).map((c) => (
                    <tr key={c.clinician + (c.tier ?? "")} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink/80">{c.clinician}</td>
                      <td className="py-2 pr-4 text-charcoal-ink/60">{c.tier ? c.tier.replace(/_/g, " ") : "—"}</td>
                      <td className={`py-2 text-right tabular-nums ${c.patients > (o?.target_ratio ?? 120) ? "font-semibold text-red-700" : ""}`}>
                        {formatNumber(c.patients)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Escalation queue"
          description="Open clinician alerts by severity."
          actions={<ExportButton filename="escalation-queue" rows={o?.escalation_queue ?? []} />}
        >
          <MiniBarList
            items={(o?.escalation_queue ?? []).map((q) => ({ label: q.level, value: q.open }))}
            emptyLabel="Queue is clear."
          />
        </SectionCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Stethoscope} label="Lab orders" value={formatNumber(orders?.lab.total ?? 0)} unit={`· ${orders?.lab.avg_turnaround_hours ?? 0}h avg`} />
        <StatTile icon={Truck} label="Pharmacy orders" value={formatNumber(orders?.pharmacy.total ?? 0)} unit={`· ${orders?.pharmacy.avg_turnaround_hours ?? 0}h avg`} />
        <StatTile icon={Send} label="Referrals" value={formatNumber(orders?.referral.total ?? 0)} unit={`· ${orders?.referral.confirmed ?? 0} confirmed`} />
      </div>

      <SectionCard
        title="Notification deliverability"
        description="Send-success rate by channel (WhatsApp / SMS / email / in-app)."
        actions={<ExportButton filename="deliverability-by-channel" rows={d?.by_channel ?? []} />}
      >
        {deliver.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (d?.by_channel ?? []).length === 0 ? (
          <CenterNote>No notifications sent yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Channel</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Sent</th>
                  <th className="py-2 pr-4 text-right font-medium">Failed</th>
                  <th className="py-2 pr-4 text-right font-medium">Pending</th>
                  <th className="py-2 text-right font-medium">Success</th>
                </tr>
              </thead>
              <tbody>
                {(d?.by_channel ?? []).map((c) => (
                  <tr key={c.channel} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">{c.channel}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(c.total)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-brand-green">{formatNumber(c.sent)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-red-700">{formatNumber(c.failed)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">{formatNumber(c.pending)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{formatPercent(c.success_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
