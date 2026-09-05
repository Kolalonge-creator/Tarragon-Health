"use client";

import { ClipboardCheck, FlaskConical, Stethoscope, Syringe } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useScreeningReferralFunnel } from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

/**
 * A vertical stepped funnel — same track/fill visual language as
 * MiniBarList (primitives.tsx), but each step also carries its drop-off
 * percentage against the stage before it, which a plain MiniBarList can't
 * show. Kept local to this dashboard rather than added to the shared
 * primitives since no other console page needs a staged drop-off view yet.
 */
function FunnelSteps({
  stages,
}: {
  stages: { stage: string; count: number; drop_off_pct: number }[];
}) {
  if (stages.length === 0) return <CenterNote>No funnel data yet.</CenterNote>;
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <ol className="space-y-4">
      {stages.map((s, i) => (
        <li key={s.stage} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium capitalize text-charcoal-ink/80">
              {i + 1}. {s.stage.replace(/_/g, " ")}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-medium tabular-nums text-charcoal-ink">{formatNumber(s.count)}</span>
              {i > 0 && (
                <span
                  className={cn(
                    "tabular-nums text-xs",
                    s.drop_off_pct > 0 ? "text-red-700" : "text-charcoal-ink/40"
                  )}
                >
                  {s.drop_off_pct > 0 ? `−${formatPercent(s.drop_off_pct)}` : "no drop-off"}
                </span>
              )}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-soft-sage">
            <div
              className="h-3 rounded-full bg-brand-green"
              style={{ width: `${Math.max((s.count / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Operations & Command Centre §96.4 — the screening -> abnormal result ->
 * clinical review -> referral -> specialist booking -> treatment pipeline.
 */
export function PatientFlowDashboard() {
  const funnel = useScreeningReferralFunnel();
  const stages = funnel.data ?? [];

  const byStage = (stage: string) => stages.find((s) => s.stage === stage)?.count ?? 0;
  const screened = byStage("screened");
  const referred = byStage("referred");
  const treated = byStage("treatment");
  const overallConversionPct = screened > 0 ? Math.round((treated / screened) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        The &ldquo;clinical review&rdquo; stage is near-1:1 with &ldquo;abnormal result&rdquo; today:
        a <code className="text-[11px]">screening_upgrades</code> row is auto-created for every
        abnormal or critical result. It is not yet a distinct human-review gate, so treat this stage
        as a marker of when the case entered review, not a measure of review activity.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={FlaskConical} label="Screened" value={formatNumber(screened)} />
        <StatTile icon={Stethoscope} label="Referred" value={formatNumber(referred)} />
        <StatTile icon={Syringe} label="Treated" value={formatNumber(treated)} />
        <StatTile
          icon={ClipboardCheck}
          label="Screened → treatment"
          value={formatPercent(overallConversionPct)}
        />
      </div>

      <SectionCard
        title="Screening → referral → treatment funnel"
        description="Staged counts and drop-off at each step of the pipeline."
        actions={<ExportButton filename="screening-referral-funnel" rows={stages} />}
      >
        {funnel.isLoading ? <CenterNote>Loading…</CenterNote> : <FunnelSteps stages={stages} />}
      </SectionCard>
    </div>
  );
}
