"use client";

import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

/**
 * Charts for the honest outcomes dashboard. They only ever receive figures the database has already cleared for showing: a held-back month or
 * group is passed as null (a gap in the bars) and never as zero. Every chart is followed on the page by the same numbers as text, so nothing
 * depends on seeing a bar.
 */

export type TrendPoint = { month: string; people: number | null; points: number | null };

const TREND_CONFIG: ChartConfig = {
  people: { label: "People active", color: "var(--color-brand-green)" },
  points: { label: "Health Points issued", color: "var(--color-clinical-navy, #12324B)" },
};

export function EngagementTrendChart({ data, label }: { data: TrendPoint[]; label: string }) {
  return (
    <div role="img" aria-label={label}>
      <ChartContainer config={TREND_CONFIG}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          <Bar dataKey="people" fill="var(--color-people)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="points" fill="var(--color-points)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export type BeforeAfterPoint = { name: string; before: number | null; after: number | null };

export function BeforeAfterChart({ data, label, beforeLabel, afterLabel }: { data: BeforeAfterPoint[]; label: string; beforeLabel: string; afterLabel: string }) {
  const config: ChartConfig = {
    before: { label: beforeLabel, color: "var(--color-clinical-navy, #12324B)" },
    after: { label: afterLabel, color: "var(--color-brand-green)" },
  };
  return (
    <div role="img" aria-label={label}>
      <ChartContainer config={config}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} domain={[0, 100]} unit="%" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          <Bar dataKey="before" fill="var(--color-before)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="after" fill="var(--color-after)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
