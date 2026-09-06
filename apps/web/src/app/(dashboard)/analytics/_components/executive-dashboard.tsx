"use client";

import { AlertTriangle, CalendarCheck, HeartPulse, Send, ShieldAlert, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useExecutiveSummary } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

/**
 * Operations & Command Centre §96.3 — a single cross-cutting rollup of the
 * platform's active clinical load: patients under active care, appointment
 * throughput, the referral and lab-order pipeline, and open clinical alerts.
 * Deliberately excludes lab-turnaround/prescription-fulfilment figures — see
 * the header comment in 20260829222010_operations_centre_analytics_rpcs.sql
 * (self-arranged fulfilment means those events mostly happen off-platform).
 */
export function ExecutiveDashboard() {
  const summary = useExecutiveSummary();
  const s = summary.data;

  const appointments = s?.appointments_90d;
  const referrals = s?.referrals;
  const alerts = s?.clinical_alerts;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Active patients" value={formatNumber(s?.active_patients ?? 0)} />
        <StatTile
          icon={HeartPulse}
          label="Active care programmes"
          value={formatNumber(s?.active_care_programmes ?? 0)}
        />
        <StatTile
          icon={CalendarCheck}
          label="Appointments booked (90d)"
          value={formatNumber(appointments?.booked ?? 0)}
          unit={`· ${formatNumber(appointments?.completed ?? 0)} completed`}
        />
        <StatTile
          icon={AlertTriangle}
          label="No-shows (90d)"
          value={formatNumber(appointments?.no_show ?? 0)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Send} label="Referrals open" value={formatNumber(referrals?.open ?? 0)} />
        <StatTile
          icon={AlertTriangle}
          label="Referrals overdue"
          value={formatNumber(referrals?.overdue ?? 0)}
          tintClassName={referrals?.overdue ? "bg-red-100" : undefined}
          iconClassName={referrals?.overdue ? "text-red-700" : undefined}
        />
        <StatTile icon={ShieldAlert} label="Clinical alerts open" value={formatNumber(alerts?.open ?? 0)} />
        <StatTile
          icon={ShieldAlert}
          label="Clinical alerts critical"
          value={formatNumber(alerts?.critical ?? 0)}
          tintClassName={alerts?.critical ? "bg-red-100" : undefined}
          iconClassName={alerts?.critical ? "text-red-700" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Lab orders by status"
          description="Current distribution across the lab-order lifecycle."
          actions={<ExportButton filename="lab-orders-by-status" rows={s?.lab_orders_by_status ?? []} />}
        >
          {summary.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <MiniBarList
              items={(s?.lab_orders_by_status ?? []).map((r) => ({ label: r.status, value: r.count }))}
              emptyLabel="No lab orders yet."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Care gaps by type"
          description="Open gaps across every gap type currently tracked."
          actions={<ExportButton filename="care-gaps-by-type" rows={s?.care_gaps_by_type ?? []} />}
        >
          {summary.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <MiniBarList
              items={(s?.care_gaps_by_type ?? []).map((r) => ({ label: r.gap_type, value: r.count }))}
              emptyLabel="No open care gaps."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
