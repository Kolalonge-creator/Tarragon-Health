"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

/** Series key -> label/colour. Colour becomes a `--color-<key>` CSS var on the
 * container, consumed via `var(--color-<key>)` in the chart's own Line/Bar
 * `stroke`/`fill` props — same theming convention as the brand palette in
 * globals.css. */
export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactElement;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color])
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div className={cn("h-64 w-full", className)} style={style}>
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

/** Recharts injects the full payload at render time via cloneElement — the
 * props below are only ever partially supplied at the JSX call site. */
export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  const ctx = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-charcoal-ink/10 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-charcoal-ink">{label}</p>
      {payload.map((entry) => {
        const key = String(entry.dataKey);
        return (
          <p key={key} style={{ color: entry.color }}>
            {ctx?.config[key]?.label ?? key}: {entry.value}
          </p>
        );
      })}
    </div>
  );
}
