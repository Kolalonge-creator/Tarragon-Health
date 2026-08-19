"use client";

import type { ReactNode } from "react";

export { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";

/** A titled block that never splits across a printed page mid-section. */
export function PrintSection({
  title,
  description,
  children,
  breakBefore,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section className={`mb-6 print-avoid-break ${breakBefore ? "print-page-break-before" : ""}`}>
      <h2 className="font-heading text-base font-semibold text-clinical-navy">{title}</h2>
      {description && <p className="mb-2 text-xs text-charcoal-ink/60">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function PrintTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">{children}</table>
    </div>
  );
}

export function PrintTh({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-charcoal-ink/20 py-1.5 pr-3 font-medium text-charcoal-ink/60 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

export function PrintTd({ children, right, muted }: { children: ReactNode; right?: boolean; muted?: boolean }) {
  return (
    <td className={`border-b border-charcoal-ink/5 py-1.5 pr-3 ${right ? "text-right tabular-nums" : ""} ${muted ? "text-charcoal-ink/50" : "text-charcoal-ink/80"}`}>
      {children}
    </td>
  );
}

export function PrintEmpty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-xs text-charcoal-ink/40">{children}</p>;
}

export function PrintKeyValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-charcoal-ink/5 py-1 text-xs">
      <span className="text-charcoal-ink/60">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold text-charcoal-ink" : "text-charcoal-ink/80"}`}>{value}</span>
    </div>
  );
}

/** A boxed disclaimer — every pack carries at least one of these; this is
 * reference material assembled from live data, never a filing/legal/audit
 * opinion in itself. */
export function Disclaimer({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 rounded-md border border-sprout-gold/40 bg-sprout-gold/10 px-3 py-2 text-[11px] leading-relaxed text-charcoal-ink/70 print-avoid-break">
      {children}
    </p>
  );
}
