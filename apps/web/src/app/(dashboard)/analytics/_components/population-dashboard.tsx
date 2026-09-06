"use client";

import { Activity, AlertTriangle, HeartPulse, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  usePopulationSummary,
  useGeoHealthAggregates,
  useDiseaseSurveillance,
  useProgrammeFunnel,
} from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { paletteColor } from "./chart-palette";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function PopulationDashboard() {
  const { data: s, isLoading } = usePopulationSummary();
  const { data: geo, isLoading: geoLoading } = useGeoHealthAggregates();
  const { data: surveillance, isLoading: surveillanceLoading } = useDiseaseSurveillance("month");
  const { data: funnel, isLoading: funnelLoading } = useProgrammeFunnel();

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

      <SectionCard
        title="Programme funnel"
        description="Enrolled → actively monitored → controlled/uncontrolled → lost to follow-up, per chronic condition. Controlled/uncontrolled only exists today for hypertension (BP) and diabetes (glucose), shown as “—” elsewhere."
        actions={<ExportButton filename="programme-funnel" rows={funnel ?? []} />}
      >
        {funnelLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : !funnel || funnel.length === 0 ? (
          <CenterNote>No active care plans yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Condition</th>
                  <th className="py-2 pr-4 font-medium">Enrolled</th>
                  <th className="py-2 pr-4 font-medium">Monitoring</th>
                  <th className="py-2 pr-4 font-medium">Controlled</th>
                  <th className="py-2 pr-4 font-medium">Uncontrolled</th>
                  <th className="py-2 pr-4 font-medium">Lost to follow-up</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((row) => (
                  <tr key={row.condition} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink">
                      {row.condition.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{row.enrolled}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.monitoring}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.controlled ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.uncontrolled ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.lost_to_follow_up}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Disease surveillance"
        description="New enrollments, risk-score computations, and screening results by month. Reports inflow, not a historical prevalence snapshot. Care plans only store current status, not a status-as-of-past-date history."
        actions={<ExportButton filename="disease-surveillance" rows={surveillance?.new_enrollment_trend ?? []} />}
      >
        {surveillanceLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : !surveillance || surveillance.new_enrollment_trend.length === 0 ? (
          <CenterNote>No care-plan enrollments recorded yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 font-medium">Condition</th>
                  <th className="py-2 pr-4 font-medium">New enrollments</th>
                </tr>
              </thead>
              <tbody>
                {surveillance.new_enrollment_trend.map((row) => (
                  <tr key={`${row.bucket}-${row.condition}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink">{row.bucket.slice(0, 7)}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {row.condition.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Geographic distribution"
        description="State-level risk concentration and overdue-screening load, never anyone's own location. A state with fewer than 10 patients shows as insufficient data, not a number."
        actions={<ExportButton filename="geographic-health" rows={geo ?? []} />}
      >
        {geoLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : !geo || geo.length === 0 ? (
          <CenterNote>No patient locations recorded yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 font-medium">Patients</th>
                  <th className="py-2 pr-4 font-medium">High-risk hypertension</th>
                  <th className="py-2 pr-4 font-medium">High-risk diabetes</th>
                  <th className="py-2 pr-4 font-medium">High-risk CVD</th>
                  <th className="py-2 pr-4 font-medium">Overdue screenings</th>
                </tr>
              </thead>
              <tbody>
                {geo.map((row) => (
                  <tr key={row.state} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink">{row.state}</td>
                    {row.suppressed ? (
                      <td className="py-2 pr-4 text-charcoal-ink/40" colSpan={5}>
                        Insufficient data
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-4 tabular-nums">{row.patient_count}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.hypertension_high_count}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.diabetes_high_count}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.cvd_high_count}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.overdue_screening_count}</td>
                      </>
                    )}
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
