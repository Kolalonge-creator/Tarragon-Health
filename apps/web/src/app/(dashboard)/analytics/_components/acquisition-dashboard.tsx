"use client";

import { useState } from "react";
import { Eye, Globe, MousePointerClick, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import {
  useAcquisitionFunnel,
  useTrafficSummary,
  useTrafficTimeseries,
  type GrowthPeriod,
} from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const TRAFFIC_CONFIG: ChartConfig = {
  visitors: { label: "Visitors", color: "var(--color-chart-analytics-1)" },
  pageviews: { label: "Pageviews", color: "var(--color-chart-analytics-3)" },
};

const PERIODS: GrowthPeriod[] = ["day", "week", "month"];

export function AcquisitionDashboard() {
  const [period, setPeriod] = useState<GrowthPeriod>("day");
  const summary = useTrafficSummary();
  const series = useTrafficTimeseries(period);
  const funnel = useAcquisitionFunnel();

  const s = summary.data;
  const seriesRows = series.data ?? [];
  const funnelRows = funnel.data ?? [];

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Geography is derived from the visitor&rsquo;s network location (no IP is stored). Country and
        state are reliable; city is approximate. In local dev, visitors show as
        &ldquo;Unknown&rdquo; because edge geo headers are only present in production.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Visitors" value={formatNumber(s?.visitors ?? 0)} />
        <StatTile icon={Eye} label="Pageviews" value={formatNumber(s?.pageviews ?? 0)} />
        <StatTile
          icon={MousePointerClick}
          label="Signed-in visitors"
          value={formatNumber(s?.logged_in_visitors ?? 0)}
        />
        <StatTile icon={Globe} label="Countries" value={formatNumber(s?.by_country.length ?? 0)} />
      </div>

      <SectionCard
        title="Traffic over time"
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
            <ExportButton filename={`traffic-${period}`} rows={seriesRows} />
          </div>
        }
      >
        {series.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : seriesRows.length === 0 ? (
          <CenterNote>No traffic recorded yet.</CenterNote>
        ) : (
          <ChartContainer config={TRAFFIC_CONFIG}>
            <AreaChart data={seriesRows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--color-soft-sage)" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area type="monotone" dataKey="pageviews" stroke="var(--color-pageviews)" fill="var(--color-pageviews)" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="visitors" stroke="var(--color-visitors)" fill="var(--color-visitors)" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Top countries"
          actions={<ExportButton filename="visitors-by-country" rows={s?.by_country ?? []} />}
        >
          <MiniBarList
            items={(s?.by_country ?? []).map((c) => ({ label: c.country, value: c.visitors }))}
            emptyLabel="No visitors yet."
          />
        </SectionCard>
        <SectionCard
          title="Top states / regions"
          actions={<ExportButton filename="visitors-by-region" rows={s?.by_region ?? []} />}
        >
          <MiniBarList
            items={(s?.by_region ?? []).map((r) => ({ label: r.region, value: r.visitors }))}
            emptyLabel="No visitors yet."
          />
        </SectionCard>
        <SectionCard
          title="Devices"
          actions={<ExportButton filename="visitors-by-device" rows={s?.by_device ?? []} />}
        >
          <MiniBarList
            items={(s?.by_device ?? []).map((d) => ({ label: d.device, value: d.visitors }))}
            emptyLabel="No visitors yet."
          />
        </SectionCard>
        <SectionCard
          title="Referrers"
          actions={<ExportButton filename="visitors-by-referrer" rows={s?.by_referrer ?? []} />}
        >
          <MiniBarList
            items={(s?.by_referrer ?? []).map((r) => ({ label: r.referrer_host, value: r.visitors }))}
            emptyLabel="No referrers yet."
          />
        </SectionCard>
        <SectionCard
          title="Campaign sources (UTM)"
          actions={<ExportButton filename="visitors-by-source" rows={s?.by_source ?? []} />}
        >
          <MiniBarList
            items={(s?.by_source ?? []).map((r) => ({ label: r.source, value: r.visitors }))}
            emptyLabel="No campaign traffic yet."
          />
        </SectionCard>
        <SectionCard
          title="Acquisition funnel"
          description="Visitor → lead → signup → onboarded → paid (indicative)."
          actions={<ExportButton filename="acquisition-funnel" rows={funnelRows} />}
        >
          <MiniBarList
            items={funnelRows.map((f) => ({ label: f.step, value: f.count }))}
            emptyLabel="No funnel data yet."
          />
        </SectionCard>
      </div>
    </div>
  );
}
