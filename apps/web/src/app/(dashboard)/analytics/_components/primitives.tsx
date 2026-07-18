"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A titled card with an optional actions slot (e.g. an ExportButton). */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base text-clinical-navy">{title}</CardTitle>
          {description && <p className="mt-1 text-xs text-charcoal-ink/60">{description}</p>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function CenterNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center py-6 text-center text-sm text-charcoal-ink/50">
      {children}
    </div>
  );
}

/** Horizontal labelled bars for a small categorical distribution — lighter than
 * a full recharts chart for side-panel breakdowns. */
export function MiniBarList({
  items,
  emptyLabel = "No data yet.",
}: {
  items: { label: string; value: number; display?: string }[];
  emptyLabel?: string;
}) {
  if (items.length === 0) return <CenterNote>{emptyLabel}</CenterNote>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="capitalize text-charcoal-ink/80">{item.label.replace(/_/g, " ")}</span>
            <span className="font-medium tabular-nums text-charcoal-ink">
              {item.display ?? item.value.toLocaleString("en-NG")}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-soft-sage">
            <div
              className={cn("h-1.5 rounded-full bg-brand-green")}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
