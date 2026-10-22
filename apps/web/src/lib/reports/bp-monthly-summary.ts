import { computeBpControlRate, type ControlGateRule, type ControlReading } from "@tarragon/clinical";
import { buildMonthlyView, monthLabel, parseMonthlyPayload, t, type Locale } from "@tarragon/i18n";

/**
 * The patient-held monthly blood pressure and medicines summary (S07x). It is built from what the patient already owns:
 * her stored monthly report (S38c, `my_monthly_reports`, readings and adherence) and her completed seven-day home checks (`home_bp_checks`).
 * It deliberately reads NO laboratory table, so an unreleased result can never appear in it, and it holds no clinician-only fact (a pattern flag, a clinic
 * reading). Adherence is worded as "doses you marked taken" and is never described as a clinical measure or graded.
 * Pure: strings come from the catalogue, nothing reads a clock or a database here.
 */
export interface HomeCheckRow {
  window_end: string;
  mean_systolic: number;
  mean_diastolic: number;
  readings: number;
  days: number;
}

export interface BpMonthlySummary {
  month: string;
  title: string;
  subtitle: string;
  bpLines: string[];
  weeks: string[];
  homeChecks: string[];
  adherence: string;
  /** Share of the month's home readings in the patient's target. Null when the caller supplied no readings (nothing is said). */
  controlRate: string | null;
  footer: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function checkDate(iso: string, locale: Locale): string {
  void locale;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** `month` is the first day of the month (YYYY-MM-01); null picks the newest report. Returns null when there is no such report. */
export function buildBpMonthlySummary(args: {
  patientName: string;
  reportRows: unknown;
  month: string | null;
  checks: readonly HomeCheckRow[];
  /**
   * The patient's own home blood pressure readings for the month. When given, the summary says how many were inside her target, only
   * once the existing average gate is met (otherwise it says there are not enough readings). Omit it to leave the line out.
   */
  control?: { readings: readonly ControlReading[]; gateRules: readonly ControlGateRule[]; minGapMinutes: number };
  locale?: Locale;
}): BpMonthlySummary | null {
  const locale = args.locale ?? "en";
  if (!Array.isArray(args.reportRows)) return null;
  const payloads = args.reportRows.flatMap((row) => (isObj(row) ? [parseMonthlyPayload(row["payload"])] : [])).filter((p) => p !== null);
  const payload = args.month === null ? payloads[0] : payloads.find((p) => p.month === args.month);
  if (!payload) return null;

  // The view's last line is the adherence sentence of the monthly report; it is replaced by the "doses you marked taken" wording below.
  const view = buildMonthlyView({ ...payload, adherence_pct: null }, locale);
  const bpLines = view.lines.slice(0, -1);
  const monthStart = payload.month;
  const monthEnd = new Date(Date.parse(`${monthStart}T00:00:00Z`));
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const endKey = monthEnd.toISOString().slice(0, 10);
  const homeChecks = args.checks
    .filter((c) => c.window_end >= monthStart && c.window_end < endKey)
    .sort((a, b) => a.window_end.localeCompare(b.window_end))
    .map((c) =>
      t("bpsummary.home_check", locale, { date: checkDate(c.window_end, locale), sys: c.mean_systolic, dia: c.mean_diastolic, readings: c.readings, days: c.days }),
    );

  let controlRate: string | null = null;
  if (args.control) {
    // The last instant of the month in LAGOS time (UTC+1): midnight UTC at the end of the month is already 01:00 on the 1st in Lagos.
    const lastMs = Math.min(Date.parse(`${endKey}T00:00:00Z`) - 3_600_000 - 1, Date.now());
    const rate = computeBpControlRate({
      readings: args.control.readings,
      target: { systolicBelow: payload.target.systolic, diastolicBelow: payload.target.diastolic },
      gateRules: args.control.gateRules,
      nowMs: lastMs,
      periodDays: Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${monthStart}T00:00:00Z`)) / 86_400_000),
      minGapMinutes: args.control.minGapMinutes,
    });
    controlRate = rate.gateMet
      ? t("bpsummary.control_rate", locale, { inTarget: rate.inTarget ?? 0, total: rate.counted, pct: rate.percentInTarget ?? 0, days: rate.days })
      : t("bpsummary.control_rate_none", locale);
  }

  return {
    month: monthStart,
    title: t("bpsummary.title", locale),
    subtitle: t("bpsummary.subtitle", locale, { name: args.patientName, month: monthLabel(monthStart) }),
    bpLines,
    weeks: view.weeks,
    homeChecks,
    adherence: payload.adherence_pct === null ? t("bpsummary.adherence_none", locale) : t("bpsummary.adherence", locale, { pct: payload.adherence_pct }),
    controlRate,
    footer: t("bpsummary.footer", locale),
  };
}

/** The month a summary would be for (first day, YYYY-MM-01), so the caller can load that month's readings first. Null when there is none. */
export function resolveSummaryMonth(reportRows: unknown, month: string | null): string | null {
  if (!Array.isArray(reportRows)) return null;
  const payloads = reportRows.flatMap((row) => (isObj(row) ? [parseMonthlyPayload(row["payload"])] : [])).filter((p) => p !== null);
  const found = month === null ? payloads[0] : payloads.find((p) => p.month === month);
  return found ? found.month : null;
}
