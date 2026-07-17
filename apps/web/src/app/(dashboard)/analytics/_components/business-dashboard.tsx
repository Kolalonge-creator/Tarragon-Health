"use client";

import { useState } from "react";
import { Building2, CreditCard, UserCheck, Users } from "lucide-react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { useBusinessSummary, useGrowthTimeseries, type GrowthPeriod } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { paletteColor } from "./chart-palette";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const GROWTH_CONFIG: ChartConfig = {
  signups: { label: "Signups", color: "var(--color-chart-analytics-1)" },
  new_subscriptions: { label: "New subscriptions", color: "var(--color-chart-analytics-3)" },
};

const PERIODS: GrowthPeriod[] = ["day", "week", "month"];

export function BusinessDashboard() {
  const [period, setPeriod] = useState<GrowthPeriod>("month");
  const summary = useBusinessSummary();
  const growth = useGrowthTimeseries(period);

  const s = summary.data;
  const growthRows = growth.data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Building2} label="Organisations" value={formatNumber(s?.total_orgs ?? 0)} />
        <StatTile icon={Users} label="Patients" value={formatNumber(s?.total_patients ?? 0)} />
        <StatTile
          icon={CreditCard}
          label="Active subscriptions"
          value={formatNumber(s?.active_subscriptions ?? 0)}
        />
        <StatTile
          icon={UserCheck}
          label="Onboarded patients"
          value={formatNumber(s?.onboarded_patients ?? 0)}
        />
      </div>

      <SectionCard
        title="Growth over time"
        description="New account signups and new subscriptions per period."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "default" : "outline"}
                  onClick={() => setPeriod(p)}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
            <ExportButton filename={`growth-${period}`} rows={growthRows} />
          </div>
        }
      >
        {growth.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : growthRows.length === 0 ? (
          <CenterNote>No growth data yet.</CenterNote>
        ) : (
          <ChartContainer config={GROWTH_CONFIG}>
            <LineChart data={growthRows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--color-soft-sage)" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="signups"
                stroke="var(--color-signups)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="new_subscriptions"
                stroke="var(--color-new_subscriptions)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Accounts by role"
          actions={<ExportButton filename="accounts-by-role" rows={s?.roles ?? []} />}
        >
          {!s || s.roles.length === 0 ? (
            <CenterNote>No accounts yet.</CenterNote>
          ) : (
            <ChartContainer config={{}} className="h-56">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie data={s.roles} dataKey="count" nameKey="role" innerRadius={45} outerRadius={80}>
                  {s.roles.map((entry, i) => (
                    <Cell key={entry.role} fill={paletteColor(i)} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Organisations by type"
          actions={<ExportButton filename="orgs-by-type" rows={s?.org_types ?? []} />}
        >
          <MiniBarList
            items={(s?.org_types ?? []).map((o) => ({ label: o.type, value: o.count }))}
            emptyLabel="No organisations yet."
          />
        </SectionCard>

        <SectionCard
          title="Patients by state"
          actions={<ExportButton filename="patients-by-state" rows={s?.states ?? []} />}
        >
          <MiniBarList
            items={(s?.states ?? []).map((st) => ({ label: st.state, value: st.count }))}
            emptyLabel="No patients yet."
          />
        </SectionCard>
      </div>
    </div>
  );
}
