"use client";

import { Activity, AlertTriangle, HeartPulse, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { usePopulationSummary } from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { paletteColor } from "./chart-palette";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function PopulationDashboard() {
  const { data: s, isLoading } = usePopulationSummary();

  const riskItems = (s?.risk_distribution ?? []).map((r) => ({
    label: r.risk_level ?? "unscored",
    value: r.patients,
  }));
  const highRisk = (s?.risk_distribution ?? [])
    .filter((r) => r.risk_level === "high" || r.risk_level === "very_high")
    .reduce((sum, r) => sum + r.patients, 0);
  const careGapTotal = (s?.care_gaps ?? []).reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Patients" value={formatNumber(s?.total_patients ?? 0)} />
        <StatTile
          icon={HeartPulse}
          label="High / very-high risk"
          value={formatNumber(highRisk)}
        />
        <StatTile
          icon={AlertTriangle}
          label="Abnormal screening rate"
          value={formatPercent(s?.abnormal_screening_rate ?? 0)}
        />
        <StatTile icon={Activity} label="Open care gaps" value={formatNumber(careGapTotal)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Chronic condition prevalence"
          description="Distinct patients on an active care plan, by condition."
          actions={
            <ExportButton filename="condition-prevalence" rows={s?.condition_prevalence ?? []} />
          }
        >
          <MiniBarList
            items={(s?.condition_prevalence ?? []).map((c) => ({
              label: c.condition,
              value: c.patients,
            }))}
            emptyLabel="No active care plans yet."
          />
        </SectionCard>

        <SectionCard
          title="Risk distribution"
          description="Latest risk score per patient."
          actions={<ExportButton filename="risk-distribution" rows={s?.risk_distribution ?? []} />}
        >
          <MiniBarList items={riskItems} emptyLabel="No risk scores yet." />
        </SectionCard>

        <SectionCard
          title="Age bands"
          actions={<ExportButton filename="age-bands" rows={s?.age_bands ?? []} />}
        >
          {isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (s?.age_bands ?? []).length === 0 ? (
            <CenterNote>No patient ages recorded yet.</CenterNote>
          ) : (
            <ChartContainer config={{}} className="h-56">
              <BarChart data={s?.age_bands ?? []} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--color-soft-sage)" />
                <XAxis dataKey="band" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {(s?.age_bands ?? []).map((entry, i) => (
                    <Cell key={entry.band} fill={paletteColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Sex distribution"
          actions={<ExportButton filename="sex-distribution" rows={s?.sex_distribution ?? []} />}
        >
          {isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (s?.sex_distribution ?? []).length === 0 ? (
            <CenterNote>No patients yet.</CenterNote>
          ) : (
            <ChartContainer config={{}} className="h-56">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={s?.sex_distribution ?? []}
                  dataKey="count"
                  nameKey="sex"
                  innerRadius={45}
                  outerRadius={80}
                >
                  {(s?.sex_distribution ?? []).map((entry, i) => (
                    <Cell key={entry.sex} fill={paletteColor(i)} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Care gaps"
        description="Overdue screenings, stale chronic monitoring, and unactioned abnormal results."
        actions={<ExportButton filename="care-gaps" rows={s?.care_gaps ?? []} />}
      >
        <MiniBarList
          items={(s?.care_gaps ?? []).map((g) => ({ label: g.gap_type, value: g.count }))}
          emptyLabel="No open care gaps."
        />
      </SectionCard>
    </div>
  );
}
