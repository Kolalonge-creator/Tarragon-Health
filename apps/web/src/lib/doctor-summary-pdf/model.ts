import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import type { ScheduleSpec } from "@tarragon/medicines";

/**
 * The patient-generated visit summary (spec 2.9, second slice): blood pressure, medicines, adherence and symptoms in one PDF
 * the patient builds by ticking sections. S43 already ships the one-page facility summary (allergies, medicines, conditions,
 * latest reading of each kind, released results, vaccinations, procedures, family history); this adds what that page does not
 * carry: a reading series with an average, a chart, the schedule, weekly adherence, skipped doses and the symptom journal.
 *
 * Everything here is pure. It describes; it never grades. There is no "high", "controlled" or "target" anywhere in this
 * module, and a wearable reading is listed but never averaged or charted.
 */

export const SECTION_KEYS = ["bp", "bp_chart", "medicines", "adherence", "skipped", "symptoms", "allergies_conditions"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SummaryConfig {
  periodDays: number[];
  defaultDays: number;
  maxBpRows: number;
  maxSymptoms: number;
  maxSkippedDoses: number;
  averageSources: string[];
}

export function summaryConfig(): SummaryConfig {
  const v = getProposedConfig("record.doctor_summary_pdf").value as Partial<SummaryConfig>;
  const ok =
    Array.isArray(v.periodDays) && v.periodDays.length > 0 && v.periodDays.every((d) => Number.isInteger(d) && d >= 7 && d <= 180) &&
    typeof v.defaultDays === "number" && (v.periodDays as number[]).includes(v.defaultDays) &&
    [v.maxBpRows, v.maxSymptoms, v.maxSkippedDoses].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 200) &&
    Array.isArray(v.averageSources) && v.averageSources.length > 0;
  if (!ok) throw new Error("Config record.doctor_summary_pdf is malformed");
  return v as SummaryConfig;
}

/** What the patient asked for. Unknown section names are rejected, never ignored: a typo must not silently drop a section. */
export function requestSchema(cfg: SummaryConfig) {
  return z.object({
    days: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v == null || v === "" ? cfg.defaultDays : Number(v)))
      .refine((n) => cfg.periodDays.includes(n), "period not allowed"),
    sections: z
      .array(z.enum(SECTION_KEYS))
      .min(1, "choose at least one section")
      .transform((s) => [...new Set(s)] as SectionKey[]),
  });
}

// ---------------------------------------------------------------------------
// Blood pressure
// ---------------------------------------------------------------------------

export interface BpReadingIn {
  takenAt: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  source: string;
  validationStatus: string;
}

export type BpTrust = "typed_by_patient" | "home_cuff" | "photo_confirmed" | "wearable" | "imported" | "other";

export const BP_SOURCE_LABEL: Record<BpTrust, string> = {
  typed_by_patient: "typed in by the patient",
  home_cuff: "home cuff, sent by Bluetooth",
  photo_confirmed: "photo of a cuff display, confirmed by the patient",
  wearable: "wearable estimate, not in the average",
  imported: "imported from another record, not in the average",
  other: "other source, not in the average",
};

export function trustOf(source: string): BpTrust {
  switch (source) {
    case "manual": return "typed_by_patient";
    case "device": return "home_cuff";
    case "photo_confirmed": return "photo_confirmed";
    case "wearable": return "wearable";
    case "fhir_import": return "imported";
    default: return "other";
  }
}

export interface BpLine {
  takenAt: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  trust: BpTrust;
  inAverage: boolean;
}

export interface ChartPoint { x: number; y: number }
export interface BpChart {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  systolic: ChartPoint[];
  diastolic: ChartPoint[];
  yTicks: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
  yMin: number;
  yMax: number;
}

export interface BpSection {
  /** Newest first, capped. Wearable and imported readings are in here, labelled. */
  lines: BpLine[];
  /** Valid readings in the period before the cap. */
  totalListed: number;
  /** Not counted anywhere: validation did not pass, or a missing value. */
  notCounted: number;
  /** Readings that were listed but kept out of the average and chart because of where they came from. */
  excludedFromAverage: number;
  average: { systolic: number; diastolic: number; count: number } | null;
  /** Oldest first. Only readings that count towards the average. */
  chartReadings: { takenAt: string; systolic: number; diastolic: number }[];
  /** The list was cut at the cap; the average and chart still use every counted reading. */
  truncated: boolean;
}

export function buildBpSection(readings: readonly BpReadingIn[], cfg: SummaryConfig): BpSection {
  const usable: { r: BpReadingIn; systolic: number; diastolic: number }[] = [];
  let notCounted = 0;
  for (const r of readings) {
    if (r.validationStatus !== "valid" || r.systolic == null || r.diastolic == null || !Number.isFinite(Date.parse(r.takenAt))) {
      notCounted += 1;
      continue;
    }
    usable.push({ r, systolic: r.systolic, diastolic: r.diastolic });
  }
  usable.sort((a, b) => Date.parse(b.r.takenAt) - Date.parse(a.r.takenAt));
  const counted = usable.filter((u) => cfg.averageSources.includes(u.r.source));
  const average =
    counted.length === 0
      ? null
      : {
          systolic: Math.round(counted.reduce((a, c) => a + c.systolic, 0) / counted.length),
          diastolic: Math.round(counted.reduce((a, c) => a + c.diastolic, 0) / counted.length),
          count: counted.length,
        };
  const lines: BpLine[] = usable.slice(0, cfg.maxBpRows).map((u) => ({
    takenAt: u.r.takenAt,
    systolic: u.systolic,
    diastolic: u.diastolic,
    pulse: u.r.pulse,
    trust: trustOf(u.r.source),
    inAverage: cfg.averageSources.includes(u.r.source),
  }));
  return {
    lines,
    totalListed: usable.length,
    notCounted,
    excludedFromAverage: usable.length - counted.length,
    average,
    chartReadings: [...counted].reverse().map((c) => ({ takenAt: c.r.takenAt, systolic: c.systolic, diastolic: c.diastolic })),
    truncated: usable.length > cfg.maxBpRows,
  };
}

const CHART_W = 500;
const CHART_H = 170;

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

/**
 * Chart geometry in plain numbers, so the drawing code is only a mapping to shapes. Two lines that differ by line style AND by
 * marker shape AND by a written label (systolic: solid with round markers, diastolic: dashed with square markers), so a
 * black and white photocopy loses nothing. No reference bands and no colour coding: a band would be a verdict.
 */
export function buildBpChart(readings: readonly { takenAt: string; systolic: number; diastolic: number }[]): BpChart | null {
  if (readings.length === 0) return null;
  const plot = { left: 34, right: CHART_W - 10, top: 10, bottom: CHART_H - 26 };
  const times = readings.map((r) => Date.parse(r.takenAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const lo = Math.min(...readings.map((r) => r.diastolic));
  const hi = Math.max(...readings.map((r) => r.systolic));
  const yMin = Math.floor((lo - 10) / 10) * 10;
  const yMax = Math.ceil((hi + 10) / 10) * 10;
  const xOf = (ms: number) => (t1 === t0 ? (plot.left + plot.right) / 2 : plot.left + ((ms - t0) / (t1 - t0)) * (plot.right - plot.left));
  const yOf = (v: number) => plot.bottom - ((v - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
  const round = (n: number) => Math.round(n * 10) / 10;
  const step = yMax - yMin > 80 ? 20 : 10;
  const yTicks: BpChart["yTicks"] = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push({ y: round(yOf(v)), label: String(v) });
  const xLabels: BpChart["xLabels"] =
    t1 === t0 ? [{ x: round(xOf(t0)), label: shortDate(t0) }] : [{ x: round(plot.left), label: shortDate(t0) }, { x: round(plot.right), label: shortDate(t1) }];
  return {
    width: CHART_W,
    height: CHART_H,
    plot,
    systolic: readings.map((r) => ({ x: round(xOf(Date.parse(r.takenAt))), y: round(yOf(r.systolic)) })),
    diastolic: readings.map((r) => ({ x: round(xOf(Date.parse(r.takenAt))), y: round(yOf(r.diastolic)) })),
    yTicks,
    xLabels,
    yMin,
    yMax,
  };
}

// ---------------------------------------------------------------------------
// Medicines, skipped doses, symptoms
// ---------------------------------------------------------------------------

export interface MedicineLine {
  name: string;
  dose: string | null;
  schedule: string;
  /** A signed prescription stands behind it; otherwise the patient added it. */
  prescribed: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FOOD: Record<string, string> = { with_food: "with food", before_food: "before food", after_food: "after food", empty_stomach: "on an empty stomach", bedtime: "at bedtime" };

/** The schedule in the words the patient would say. Reads the spec; never changes it. */
export function describeSchedule(spec: ScheduleSpec | null, fallbackFrequency: string | null): string {
  if (!spec) return fallbackFrequency ?? "no schedule set";
  const food = spec.foodNote && FOOD[spec.foodNote] ? `, ${FOOD[spec.foodNote]}` : "";
  const times = (ts: string[]) => ts.join(", ");
  switch (spec.kind) {
    case "daily": return `every day at ${times(spec.times)}${food}`;
    case "every_n_days": return `every ${spec.intervalDays} days at ${times(spec.times)}${food}`;
    case "weekdays": return `${spec.days.map((d) => DAY_NAMES[d] ?? "").filter(Boolean).join(", ")} at ${times(spec.times)}${food}`;
    case "taper": return `a tapering course in ${spec.steps.length} steps${food}`;
    case "as_needed": return spec.maxPerDay ? `only when needed, at most ${spec.maxPerDay} a day${food}` : `only when needed${food}`;
  }
}

export interface SkippedDoseIn {
  date: string;
  time: string;
  medicine: string;
  missedReason: string | null;
  reason: string | null;
}
export interface SkippedLine { when: string; medicine: string; reason: string }

const SKIP_REASON: Record<string, string> = {
  forgot: "forgot",
  device_unavailable: "phone or device not to hand",
  doesnt_understand: "did not understand the instructions",
  doesnt_want_to: "chose not to take it",
  feels_well: "felt well",
  technical_problem: "a problem with the app",
};

export function buildSkipped(rows: readonly SkippedDoseIn[], cfg: SummaryConfig): { lines: SkippedLine[]; total: number } {
  const sorted = [...rows].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return {
    total: sorted.length,
    lines: sorted.slice(0, cfg.maxSkippedDoses).map((r) => {
      const parts = [r.missedReason ? SKIP_REASON[r.missedReason] ?? null : null, r.reason ? r.reason.trim().slice(0, 120) : null].filter((p): p is string => !!p);
      const d = new Date(`${r.date}T00:00:00Z`);
      const when = `${Number.isNaN(d.getTime()) ? r.date : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}, ${r.time}`;
      return { when, medicine: r.medicine, reason: parts.length > 0 ? parts.join(", ") : "no reason given" };
    }),
  };
}

export interface SymptomIn { reportedAt: string; symptomType: string; freeText: string | null; severity: number | null }
export interface SymptomLine { reportedAt: string; label: string; note: string | null; severity: number | null }

/**
 * Symptom types that name reproductive organs. Reproductive health is never a section of a summary or a share (OQ-S43-4), so an
 * entry of these types is left out whole rather than printed. A free-text note cannot be classified, which is the same open
 * limit OQ-S43-4 records for the medicines list; the screen says so.
 */
export const REPRODUCTIVE_SYMPTOM_TYPES: readonly string[] = ["testicular_pain", "testicular_lump"];

export function buildSymptoms(rows: readonly SymptomIn[], sinceMs: number, cfg: SummaryConfig): { lines: SymptomLine[]; total: number; leftOut: number } {
  const inPeriod = rows.filter((r) => Date.parse(r.reportedAt) >= sinceMs);
  const kept = inPeriod.filter((r) => !REPRODUCTIVE_SYMPTOM_TYPES.includes(r.symptomType));
  kept.sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
  return {
    total: kept.length,
    leftOut: inPeriod.length - kept.length,
    lines: kept.slice(0, cfg.maxSymptoms).map((r) => ({
      reportedAt: r.reportedAt,
      label: r.symptomType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      note: r.freeText ? r.freeText.trim().slice(0, 200) : null,
      severity: r.severity,
    })),
  };
}
