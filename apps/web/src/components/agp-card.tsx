"use client";
import Link from "next/link";
import { useMemo } from "react";
import { GLUCOSE_UNIT_LABEL, formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { AgpChart } from "@/components/agp-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgpReadings } from "@/lib/queries/cgm";
import { computeAgp, loadAgpConfig, type AgpConfig, type AgpResult, type BandKey, type TimeInBands } from "@/lib/cgm/agp";
import {
  PATIENT_FOOTNOTE,
  clinicianFootnote,
  clinicianPatternSentence,
  insufficientSentence,
  patientPatternSentence,
  pctLabel,
  truncatedSentence,
} from "@/lib/cgm/agp-copy";
import { AGP_READ_LIMIT, AgpReadError } from "@/lib/cgm/agp-read";

type Audience = "patient" | "clinician";

/**
 * The continuous glucose profile, one component for both sides of the care relationship: the patient sees time in range, the 24 hour picture and
 * plain sentences about when readings ran high or low; the clinician sees the same picture with the full set of numbers. Both read through the
 * same audited path as the vitals chart, so a clinician's look is recorded and a refusal reads as "not available", never as "no readings".
 *
 * Renders nothing until the person has sensor readings (the card is dormant for everyone without a connected sensor). Display only: it never
 * creates a task or a page, and it never suggests a dose or a medicine.
 */
export function AgpCard({ patientId, audience, showWhenEmpty = false }: { patientId: string; audience: Audience; showWhenEmpty?: boolean }) {
  const unit = useGlucoseUnit();
  const { data, isLoading, isError, error } = useAgpReadings(patientId);
  const loaded = useMemo(() => loadAgpConfig(), []);
  const result = useMemo(() => (data ? computeAgp(data.samples, data.fetchedAt, loaded) : null), [data, loaded]);

  // Opened on purpose (the clinician's disclosure beside a message thread): say what is happening instead of showing a blank.
  const note = (text: string) => (
    <Card>
      <CardContent className="pt-4">
        <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{text}</p>
      </CardContent>
    </Card>
  );
  if (isLoading) return showWhenEmpty ? note("Loading sensor glucose.") : null;
  if (isError) {
    const denied = error instanceof AgpReadError && error.kind === "denied";
    const message =
      audience === "patient"
        ? "Your glucose profile is not available right now. Please try again later."
        : denied
          ? "Sensor glucose is not available to you for this patient."
          : "Sensor glucose could not be loaded just now. Please try again.";
    return (
      <Card>
        <CardHeader>
          <CardTitle>{audience === "patient" ? "Your glucose profile" : "Sensor glucose profile"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{message}</p>
        </CardContent>
      </Card>
    );
  }
  if (!result || result.metrics.count === 0) {
    return showWhenEmpty ? note(`No sensor glucose in the last ${loaded.config.window_days} days.`) : null;
  }

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
        {result.metrics.tir ? <RangeBar tir={result.metrics.tir} exact={result.metrics.tirExactPct} detailed={audience === "clinician"} partial={!result.sufficient} /> : null}

        {result.sufficient && data?.truncated ? (
          <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{truncatedSentence(audience, AGP_READ_LIMIT)}</p>
        ) : null}

        {result.sufficient ? (
          <>
            <AgpChart result={result} unit={unit} config={config} />
            {audience === "patient" ? <PatientPatterns result={result} unit={unit} config={config} /> : <ClinicianNumbers result={result} unit={unit} config={config} />}
          </>
        ) : (
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {data?.truncated ? truncatedSentence(audience, AGP_READ_LIMIT) : insufficientSentence(result.insufficientReason, result.metrics, config)}
          </p>
        )}

        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{audience === "patient" ? PATIENT_FOOTNOTE : clinicianFootnote(config)}</p>
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
            ? bandRows(m.tir, edges, unit).map(([name, key, pct]) => (
                <tr key={name} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                  <th scope="row" className="py-1 font-normal">{name}</th>
                  <td className="py-1 text-right font-medium">{pctLabel(pct, m.tirExactPct?.[key] ?? pct)}</td>
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
): [string, BandKey, number][] {
  const f = (v: number) => formatGlucose(v, unit) ?? "";
  return [
    [`Very high, above ${f(e.very_high)}`, "veryHighPct", t.veryHighPct],
    [`High, ${f(e.high)} to ${f(e.very_high)}`, "highPct", t.highPct],
    [`In range, ${f(e.low)} to ${f(e.high)}`, "inRangePct", t.inRangePct],
    [`Low, ${f(e.very_low)} to ${f(e.low)}`, "lowPct", t.lowPct],
    [`Very low, below ${f(e.very_low)}`, "veryLowPct", t.veryLowPct],
  ];
}

/** A stacked bar of time in range. The patient sees three groups, the clinician all five; every segment is also named in words below the bar. */
function RangeBar({ tir, exact, detailed, partial }: { tir: TimeInBands; exact: TimeInBands | null; detailed: boolean; partial: boolean }) {
  const ex = (...keys: BandKey[]) => keys.reduce((s, k) => s + (exact?.[k] ?? tir[k]), 0);
  const segments = detailed
    ? [
        { key: "vl", pct: tir.veryLowPct, exact: ex("veryLowPct"), cls: "bg-red-600", name: "very low" },
        { key: "l", pct: tir.lowPct, exact: ex("lowPct"), cls: "bg-red-400", name: "low" },
        { key: "in", pct: tir.inRangePct, exact: ex("inRangePct"), cls: "bg-brand-green", name: "in range" },
        { key: "h", pct: tir.highPct, exact: ex("highPct"), cls: "bg-amber-400", name: "high" },
        { key: "vh", pct: tir.veryHighPct, exact: ex("veryHighPct"), cls: "bg-amber-600", name: "very high" },
      ]
    : [
        { key: "l", pct: tir.veryLowPct + tir.lowPct, exact: ex("veryLowPct", "lowPct"), cls: "bg-red-400", name: "low" },
        { key: "in", pct: tir.inRangePct, exact: ex("inRangePct"), cls: "bg-brand-green", name: "in range" },
        { key: "h", pct: tir.highPct + tir.veryHighPct, exact: ex("highPct", "veryHighPct"), cls: "bg-amber-400", name: "high" },
      ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15" aria-hidden="true">
        {segments.map((s) => (s.pct > 0 ? <div key={s.key} className={s.cls} style={{ width: `${s.pct}%` }} /> : null))}
      </div>
      <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {segments.map((s) => `${pctLabel(s.pct, s.exact)} ${s.name}`).join(" · ")}
        {partial ? " (so far)" : ""}
      </p>
    </div>
  );
}
