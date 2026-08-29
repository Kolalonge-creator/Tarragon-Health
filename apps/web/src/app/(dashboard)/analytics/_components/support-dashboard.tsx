"use client";

import { LifeBuoy, Timer, TrendingUp, Gavel } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useComplaintsSummary, useSupportTicketSummary } from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";

/** §24.13/§24.16's support-centre analytics: ticket volume by category/priority/status, response/resolution time, escalation and repeat-contact rate, CSAT, and complaints governance throughput. */
export function SupportDashboard() {
  const tickets = useSupportTicketSummary();
  const complaints = useComplaintsSummary();
  const t = tickets.data;
  const c = complaints.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={LifeBuoy} label="Open tickets" value={formatNumber(t?.open_count ?? 0)} unit={`of ${formatNumber(t?.total ?? 0)} in range`} />
        <StatTile icon={Timer} label="Avg first response" value={t?.avg_first_response_minutes != null ? `${formatNumber(t.avg_first_response_minutes)}m` : "—"} />
        <StatTile icon={Timer} label="Avg resolution" value={t?.avg_resolution_minutes != null ? `${formatNumber(t.avg_resolution_minutes)}m` : "—"} />
        <StatTile icon={TrendingUp} label="CSAT" value={t?.avg_satisfaction != null ? `${t.avg_satisfaction.toFixed(1)}/5` : "—"} unit={`${formatNumber(t?.satisfaction_response_count ?? 0)} responses`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Tickets by category" description="§24.2's six support categories.">
          {tickets.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <MiniBarList items={Object.entries(t?.by_category ?? {}).map(([label, value]) => ({ label, value }))} emptyLabel="No tickets in range." />
          )}
        </SectionCard>
        <SectionCard title="Tickets by status" description="Where tickets currently sit in the §24.5 lifecycle.">
          {tickets.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <MiniBarList items={Object.entries(t?.by_status ?? {}).map(([label, value]) => ({ label, value }))} emptyLabel="No tickets in range." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile icon={TrendingUp} label="Escalation rate" value={t?.escalation_rate_pct != null ? formatPercent(t.escalation_rate_pct) : "—"} unit="clinical or technical" />
        <StatTile icon={TrendingUp} label="Repeat contact rate" value={t?.repeat_contact_rate_pct != null ? formatPercent(t.repeat_contact_rate_pct) : "—"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Gavel} label="Open complaints" value={formatNumber(c?.open_count ?? 0)} unit={`of ${formatNumber(c?.total ?? 0)} in range`} />
        <StatTile icon={Timer} label="Avg acknowledgement" value={c?.avg_acknowledgement_minutes != null ? `${formatNumber(c.avg_acknowledgement_minutes)}m` : "—"} />
        <StatTile icon={Timer} label="Avg resolution" value={c?.avg_resolution_minutes != null ? `${formatNumber(c.avg_resolution_minutes)}m` : "—"} />
        <StatTile icon={Gavel} label="Became incident reports" value={formatNumber(c?.incident_escalation_count ?? 0)} unit={`${formatNumber(c?.governance_reviewed_count ?? 0)} governance-reviewed`} />
      </div>

      <SectionCard title="Complaints by category" description="§24.14's complaints governance workflow.">
        {complaints.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <MiniBarList items={Object.entries(c?.by_category ?? {}).map(([label, value]) => ({ label, value }))} emptyLabel="No complaints in range." />
        )}
      </SectionCard>
    </div>
  );
}
