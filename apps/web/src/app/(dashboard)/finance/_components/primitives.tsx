"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export { formatMinor, formatNumber, formatPercent, currencySymbol } from "@/lib/analytics/format";

/** Money input helpers: forms collect major units, the ledger stores minor. */
export function majorToMinor(value: string | number): number {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
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
    <div className="flex min-h-20 items-center justify-center py-6 text-center text-sm text-charcoal-ink/50">
      {children}
    </div>
  );
}

/** A scroll-safe table shell — wide finance tables must never widen the page. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 pr-4 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
