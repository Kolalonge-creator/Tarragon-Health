"use client";

import { useState } from "react";
import { CalendarDays, Repeat, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import {
  useActiveUsersTimeseries,
  useEngagementSummary,
  useFeatureAdoption,
  useRetentionCohorts,
  type GrowthPeriod,
} from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const PERIODS: GrowthPeriod[] = ["day", "week", "month"];

export function EngagementDashboard() {
  const [period, setPeriod] = useState<GrowthPeriod>("day");
  const summary = useEngagementSummary();
  const active = useActiveUsersTimeseries(period);
  const adoption = useFeatureAdoption();
  const cohorts = useRetentionCohorts();

  const s = summary.data;
  const activeRows = active.data ?? [];
  const cohortRows = cohorts.data ?? [];

  // Flatten cohorts for CSV export.
  const cohortExport = cohortRows.flatMap((c) =>
    c.offsets.map((o) => ({
      cohort_week: c.cohort_week,
      cohort_size: c.cohort_size,
      week_offset: o.week_offset,
      retained: o.retained,
      retained_pct: c.cohort_size ? Math.round((o.retained / c.cohort_size) * 1000) / 10 : 0,
    }))
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={CalendarDays} label="Daily active (DAU)" value={formatNumber(s?.dau ?? 0)} />
        <StatTile icon={Users} label="Weekly active (WAU)" value={formatNumber(s?.wau ?? 0)} />
        <StatTile icon={Users} label="Monthly active (MAU)" value={formatNumber(s?.mau ?? 0)} />
        <StatTile icon={Repeat} label="Stickiness (DAU/MAU)" value={formatPercent(s?.stickiness ?? 0)} />
      </div>

      <SectionCard
        title="Active users over time"
        description="Distinct signed-in users active per period."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
                  {p[0].toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
            <ExportButton filename={`active-users-${period}`} rows={activeRows} />
          </div>
        }
      >
        {active.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : activeRows.length === 0 ? (
          <CenterNote>No activity captured yet.</CenterNote>
        ) : (
          <ChartContainer config={{}}>
            <BarChart data={activeRows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--color-soft-sage)" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="active_users" fill="var(--color-chart-analytics-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Feature adoption"
          description="Distinct patients who have used each feature."
          actions={<ExportButton filename="feature-adoption" rows={adoption.data ?? []} />}
        >
          <MiniBarList
            items={(adoption.data ?? []).map((f) => ({ label: f.feature, value: f.patients }))}
            emptyLabel="No adoption data yet."
          />
        </SectionCard>

        <SectionCard
          title="Retention cohorts"
          description="Weekly signup cohorts; retained = active in each following week."
          actions={<ExportButton filename="retention-cohorts" rows={cohortExport} />}
        >
          {cohorts.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : cohortRows.length === 0 ? (
            <CenterNote>No cohorts yet.</CenterNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Cohort week</th>
                    <th className="py-2 pr-4 text-right font-medium">Size</th>
                    <th className="py-2 pr-2 text-right font-medium">W0</th>
                    <th className="py-2 pr-2 text-right font-medium">W1</th>
                    <th className="py-2 pr-2 text-right font-medium">W2</th>
                    <th className="py-2 text-right font-medium">W3</th>
                  </tr>
                </thead>
                <tbody>
                  {cohortRows.map((c) => {
                    const at = (k: number) => c.offsets.find((o) => o.week_offset === k)?.retained ?? 0;
                    return (
                      <tr key={c.cohort_week} className="border-b border-charcoal-ink/5">
                        <td className="py-2 pr-4 text-charcoal-ink/70">{c.cohort_week}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{c.cohort_size}</td>
                        {[0, 1, 2, 3].map((k) => (
                          <td key={k} className="py-2 pr-2 text-right tabular-nums text-charcoal-ink/70">
                            {at(k)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
