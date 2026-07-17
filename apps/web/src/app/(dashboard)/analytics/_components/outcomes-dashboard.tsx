"use client";

import { Activity, HeartPulse, ShieldCheck, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useClinicalOutcomes, useEscalationQuality } from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function OutcomesDashboard() {
  const outcomes = useClinicalOutcomes();
  const escalation = useEscalationQuality();

  const o = outcomes.data;
  const e = escalation.data;

  const controlRows = [
    { metric: "BP controlled (<140/90)", controlled: o?.bp_control.controlled ?? 0, total: o?.bp_control.total ?? 0, pct: o?.bp_control.pct ?? 0 },
    { metric: "Glucose controlled (≤7.0)", controlled: o?.glucose_control.controlled ?? 0, total: o?.glucose_control.total ?? 0, pct: o?.glucose_control.pct ?? 0 },
  ];

  const funnelRows = e
    ? [
        { step: "Abnormal results", count: e.funnel.abnormal_results },
        { step: "Alerts raised", count: e.funnel.alerts_raised },
        { step: "Escalations", count: e.funnel.escalations },
        { step: "Resolved", count: e.funnel.resolved },
      ]
    : [];

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Control thresholds are indicative population-level indicators, not individual clinical
        targets.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={HeartPulse} label="BP control rate" value={formatPercent(o?.bp_control.pct ?? 0)} />
        <StatTile icon={Activity} label="Glucose control rate" value={formatPercent(o?.glucose_control.pct ?? 0)} />
        <StatTile icon={ShieldCheck} label="Escalation SLA met" value={formatPercent(e?.sla.pct_met ?? 0)} />
        <StatTile icon={TrendingUp} label="Avg resolution (hrs)" value={formatNumber(e?.avg_resolution_hours ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Chronic control rates"
          description="Latest reading per patient meeting the indicative target."
          actions={<ExportButton filename="control-rates" rows={controlRows} />}
        >
          <div className="space-y-4">
            {controlRows.map((r) => (
              <div key={r.metric} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-charcoal-ink/80">{r.metric}</span>
                  <span className="font-medium tabular-nums text-charcoal-ink">
                    {formatPercent(r.pct)} <span className="text-charcoal-ink/40">({r.controlled}/{r.total})</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-soft-sage">
                  <div className="h-2 rounded-full bg-brand-green" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Risk migration"
          description="First vs latest risk score per patient."
          actions={<ExportButton filename="risk-migration" rows={o?.risk_migration ?? []} />}
        >
          <MiniBarList
            items={(o?.risk_migration ?? []).map((r) => ({ label: r.direction, value: r.patients }))}
            emptyLabel="Not enough risk history yet."
          />
        </SectionCard>

        <SectionCard
          title="Screening coverage"
          actions={<ExportButton filename="screening-coverage" rows={o?.screening_coverage ?? []} />}
        >
          <MiniBarList
            items={(o?.screening_coverage ?? []).map((r) => ({ label: r.status, value: r.count }))}
            emptyLabel="No screening schedules yet."
          />
        </SectionCard>

        <SectionCard
          title="Vaccination coverage"
          actions={<ExportButton filename="vaccination-coverage" rows={o?.vaccination_coverage ?? []} />}
        >
          <MiniBarList
            items={(o?.vaccination_coverage ?? []).map((r) => ({ label: r.status, value: r.count }))}
            emptyLabel="No vaccination schedules yet."
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Abnormal result → escalation → resolution"
        description="The highest-priority safety pipeline. SLA compares acknowledgement against each alert's due time."
        actions={<ExportButton filename="escalation-funnel" rows={funnelRows} />}
      >
        {escalation.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <MiniBarList
              items={funnelRows.map((f) => ({ label: f.step, value: f.count }))}
              emptyLabel="No escalations yet."
            />
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-charcoal-ink/60">SLA met</span><span className="font-medium tabular-nums">{e?.sla.met ?? 0} / {e?.sla.total ?? 0} ({formatPercent(e?.sla.pct_met ?? 0)})</span></div>
              <div className="flex justify-between"><span className="text-charcoal-ink/60">SLA breached</span><span className="font-medium tabular-nums">{formatNumber(e?.sla.breached ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-charcoal-ink/60">Avg time to acknowledge</span><span className="font-medium tabular-nums">{formatNumber(e?.avg_ack_minutes ?? 0)} min</span></div>
              <div className="flex justify-between"><span className="text-charcoal-ink/60">Open alerts</span><span className="font-medium tabular-nums">{formatNumber(e?.open_alerts ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-charcoal-ink/60">Overdue alerts</span><span className="font-medium tabular-nums text-red-700">{formatNumber(e?.overdue_alerts ?? 0)}</span></div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
