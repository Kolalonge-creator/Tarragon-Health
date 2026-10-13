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

  return {
    month: monthStart,
    title: t("bpsummary.title", locale),
    subtitle: t("bpsummary.subtitle", locale, { name: args.patientName, month: monthLabel(monthStart) }),
    bpLines,
    weeks: view.weeks,
    homeChecks,
    adherence: payload.adherence_pct === null ? t("bpsummary.adherence_none", locale) : t("bpsummary.adherence", locale, { pct: payload.adherence_pct }),
    footer: t("bpsummary.footer", locale),
  };
}
