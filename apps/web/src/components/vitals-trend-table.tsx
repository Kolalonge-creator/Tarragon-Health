"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { entryOriginLabelKey, sourceBadgeLabel } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { formatPatientDateTime } from "@/lib/format-date";

/**
 * The text alternative to the vitals trend chart (P17; spec sections 10.2 and
 * 22): every plotted reading as a row, so the chart is never the only way to
 * read the numbers. The same values the chart plots, in the same unit, with
 * where each reading came from. A reading with nothing to plot for the chosen
 * measure is left out; nothing is invented, interpolated or rounded beyond
 * what the chart shows.
 */
export interface TrendTableRow {
  key: string;
  takenAt: string;
  value: string;
  unit: string;
  source: string;
}

/** One plotted point, as the chart holds it. Every field but `taken_at` is optional because each measure fills only its own. */
export interface TrendTablePoint {
  taken_at: string;
  systolic?: number | null;
  diastolic?: number | null;
  glucose_display?: number | null;
  weight_display?: number | null;
  pulse_bpm?: number | null;
  value?: number | null;
  bmi?: number | null;
  source?: string | null;
  entry_origin?: string | null;
  assisted?: boolean;
}

export type TrendTableMode = "blood_pressure" | "glucose" | "weight" | "pulse" | "hba1c" | "bmi";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Where a reading came from, in the same words as the source badge on every reading list. */
export function trendSourceLabel(p: TrendTablePoint, mode: TrendTableMode): string {
  if (mode === "hba1c") return "Lab result";
  const originKey = entryOriginLabelKey(p.entry_origin);
  const base = originKey ? t(originKey) : sourceBadgeLabel(p.source);
  return p.assisted ? `${base}, entered by a helper` : base;
}

/** The rows for one measure, newest first. `unit` is the label the chart's own axis uses. */
export function trendTableRows(mode: TrendTableMode, points: readonly TrendTablePoint[], unit: string): TrendTableRow[] {
  const rows: TrendTableRow[] = [];
  points.forEach((p, i) => {
    let value: string | null = null;
    if (mode === "blood_pressure") {
      if (isNum(p.systolic) && isNum(p.diastolic)) value = `${p.systolic}/${p.diastolic}`;
    } else {
      const v = mode === "glucose" ? p.glucose_display : mode === "weight" ? p.weight_display : mode === "pulse" ? p.pulse_bpm : mode === "hba1c" ? p.value : p.bmi;
      if (isNum(v)) value = String(v);
    }
    if (value === null) return;
    rows.push({ key: `${p.taken_at}-${i}`, takenAt: p.taken_at, value, unit, source: trendSourceLabel(p, mode) });
  });
  return rows.reverse();
}

/**
 * Folded by default (native <details>, keyboard and screen-reader friendly). The rows are rendered only while it is open, so a long range costs
 * nothing until someone asks for it, and the fold stays mounted (and open) while a new range loads instead of snapping shut.
 */
export function VitalsTrendTable({ caption, rows, loading = false }: { caption: string; rows: TrendTableRow[]; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0 && !loading) return null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group rounded-2xl border border-charcoal-ink/10 bg-white p-1 dark:border-night-ink/15 dark:bg-night-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:hover:bg-night-ink/10 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold text-charcoal-ink dark:text-night-ink">Show as a table</span>
          <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {loading ? "Loading readings" : `${rows.length} reading${rows.length === 1 ? "" : "s"}, newest first`}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-charcoal-ink/60 transition-transform group-open:rotate-180 dark:text-night-ink/60" aria-hidden />
      </summary>
      {open && (
        <div className="max-h-80 overflow-auto p-3 pt-2">
          {loading ? (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
          ) : (
            <table data-testid="vitals-trend-table" className="w-full text-left text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Value</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Unit</th>
                  <th scope="col" className="py-1 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="text-charcoal-ink dark:text-night-ink">
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatPatientDateTime(r.takenAt)}</td>
                    <td className="py-1.5 pr-3 font-medium tabular-nums">{r.value}</td>
                    <td className="py-1.5 pr-3">{r.unit}</td>
                    <td className="py-1.5 text-charcoal-ink/70 dark:text-night-ink/70">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </details>
  );
}
