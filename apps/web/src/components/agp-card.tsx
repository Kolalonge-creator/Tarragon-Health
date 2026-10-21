"use client";
import Link from "next/link";
import { useMemo } from "react";
import { GLUCOSE_UNIT_LABEL, formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { AgpChart } from "@/components/agp-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgpReadings } from "@/lib/queries/cgm";
import { computeAgp, loadAgpConfig, type AgpConfig, type AgpResult, type TimeInBands } from "@/lib/cgm/agp";
import {
  CLINICIAN_FOOTNOTE,
  PATIENT_FOOTNOTE,
  clinicianPatternSentence,
  insufficientSentence,
  patientPatternSentence,
} from "@/lib/cgm/agp-copy";

type Audience = "patient" | "clinician";

/**
 * The continuous glucose profile, one component for both sides of the care relationship: the patient sees time in range, the 24 hour picture and
 * plain sentences about when readings ran high or low; the clinician sees the same picture with the full set of numbers. Both read through the
 * same audited path as the vitals chart, so a clinician's look is recorded and a refusal reads as "not available", never as "no readings".
 *
 * Renders nothing until the person has sensor readings (the card is dormant for everyone without a connected sensor). Display only: it never
 * creates a task or a page, and it never suggests a dose or a medicine.
 */
export function AgpCard({ patientId, audience }: { patientId: string; audience: Audience }) {
  const unit = useGlucoseUnit();
  const { data, isLoading, isError } = useAgpReadings(patientId);
  const loaded = useMemo(() => loadAgpConfig(), []);
  const result = useMemo(() => (data ? computeAgp(data.samples, data.fetchedAt, loaded) : null), [data, loaded]);

  if (isLoading) return null;
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{audience === "patient" ? "Your glucose profile" : "Sensor glucose profile"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {audience === "patient" ? "Your glucose profile is not available right now. Please try again later." : "Sensor glucose is not available to you for this patient."}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (!result || result.metrics.count === 0) return null;

  const { config } = loaded;
  const days = config.window_days;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{audience === "patient" ? "Your glucose profile" : "Sensor glucose profile"}</CardTitle>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Last {days} days · {result.metrics.count.toLocaleString("en-NG")} readings · {result.metrics.daysWithData} days with data
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.metrics.tir ? <RangeBar tir={result.metrics.tir} detailed={audience === "clinician"} partial={!result.sufficient} /> : null}

        {result.sufficient ? (
          <>
            <AgpChart result={result} unit={unit} config={config} />
            {audience === "patient" ? <PatientPatterns result={result} unit={unit} config={config} /> : <ClinicianNumbers result={result} unit={unit} config={config} />}
          </>
        ) : (
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {insufficientSentence(result.metrics.daysWithData, config.min_days_with_data)}
          </p>
        )}

        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{audience === "patient" ? PATIENT_FOOTNOTE : CLINICIAN_FOOTNOTE}</p>
      </CardContent>
    </Card>
  );
}

type PanelProps = { result: AgpResult; unit: GlucoseDisplayUnit; config: AgpConfig };

function PatientPatterns({ result, unit, config }: PanelProps) {
  if (result.patterns.length === 0) return null;
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm text-charcoal-ink/90 dark:text-night-ink/90">
        {result.patterns.map((p) => (
          <li key={`${p.kind}-${p.startMinute}`}>{patientPatternSentence(p, unit, config)}</li>
        ))}
      </ul>
      <Link href="/patient/messages" className="text-sm font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright">
        Message your care team about this
      </Link>
    </div>
  );
}

function ClinicianNumbers({ result, unit, config }: PanelProps) {
  const m = result.metrics;
  const label = GLUCOSE_UNIT_LABEL[unit];
  const edges = config.band_edges_mmol_l;
  const num = (v: number | null, digits = 1) => (v === null ? "n/a" : v.toFixed(digits));
  const rows: [string, string][] = [
    ["Average glucose", m.meanMmolL === null ? "n/a" : (formatGlucose(m.meanMmolL, unit) ?? "n/a")],
    ["Glucose management indicator", m.gmiPct === null ? "n/a" : `${num(m.gmiPct)}%`],
    ["Variability (CV)", m.cvPct === null ? "n/a" : `${num(m.cvPct, 0)}%`],
    ["Standard deviation", m.sdMmolL === null ? "n/a" : (formatGlucose(m.sdMmolL, unit) ?? "n/a")],
    ["Sensor active", `${num(m.activePct, 0)}% of the window`],
  ];
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full max-w-md text-left">
        <caption className="sr-only">Time in each glucose band, in {label}</caption>
        <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          <tr>
            <th scope="col" className="py-1 font-normal">Band</th>
            <th scope="col" className="py-1 text-right font-normal">Time</th>
          </tr>
        </thead>
        <tbody>
          {m.tir
            ? bandRows(m.tir, edges, unit).map(([name, pct]) => (
                <tr key={name} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                  <th scope="row" className="py-1 font-normal">{name}</th>
                  <td className="py-1 text-right font-medium">{pct}%</td>
                </tr>
              ))
            : null}
        </tbody>
      </table>
      {result.patterns.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {result.patterns.map((p) => (
            <li key={`${p.kind}-${p.startMinute}`}>{clinicianPatternSentence(p, unit, config)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">No time of day met the pattern settings.</p>
      )}
    </div>
  );
}

function bandRows(
  t: TimeInBands,
  e: { very_low: number; low: number; high: number; very_high: number },
  unit: GlucoseDisplayUnit,
): [string, number][] {
  const f = (v: number) => formatGlucose(v, unit) ?? "";
  return [
    [`Very high, above ${f(e.very_high)}`, t.veryHighPct],
    [`High, ${f(e.high)} to ${f(e.very_high)}`, t.highPct],
    [`In range, ${f(e.low)} to ${f(e.high)}`, t.inRangePct],
    [`Low, ${f(e.very_low)} to ${f(e.low)}`, t.lowPct],
    [`Very low, below ${f(e.very_low)}`, t.veryLowPct],
  ];
}

/** A stacked bar of time in range. The patient sees three groups, the clinician all five; every segment is also named in words below the bar. */
function RangeBar({ tir, detailed, partial }: { tir: TimeInBands; detailed: boolean; partial: boolean }) {
  const segments = detailed
    ? [
        { key: "vl", pct: tir.veryLowPct, cls: "bg-red-600", name: "very low" },
        { key: "l", pct: tir.lowPct, cls: "bg-red-400", name: "low" },
        { key: "in", pct: tir.inRangePct, cls: "bg-brand-green", name: "in range" },
        { key: "h", pct: tir.highPct, cls: "bg-amber-400", name: "high" },
        { key: "vh", pct: tir.veryHighPct, cls: "bg-amber-600", name: "very high" },
      ]
    : [
        { key: "l", pct: tir.veryLowPct + tir.lowPct, cls: "bg-red-400", name: "low" },
        { key: "in", pct: tir.inRangePct, cls: "bg-brand-green", name: "in range" },
        { key: "h", pct: tir.highPct + tir.veryHighPct, cls: "bg-amber-400", name: "high" },
      ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15" aria-hidden="true">
        {segments.map((s) => (s.pct > 0 ? <div key={s.key} className={s.cls} style={{ width: `${s.pct}%` }} /> : null))}
      </div>
      <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {segments.map((s) => `${s.pct}% ${s.name}`).join(" · ")}
        {partial ? " (so far)" : ""}
      </p>
    </div>
  );
}
