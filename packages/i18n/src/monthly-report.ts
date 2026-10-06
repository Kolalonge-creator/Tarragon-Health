import { t, type Locale } from "./translate";

/**
 * The personal monthly progress report and its Care Circle summary, as the database stores them (S38c, S38d). Parsed by hand and never
 * trusted: a payload that does not match is dropped, not rendered half-way. Both the web and the mobile app use this one module, so the
 * two cannot describe a month differently. It holds numbers and keys only; every sentence comes from the catalogues so it reads in English
 * or Pidgin, and nothing here compares the person with anyone else.
 */
export interface MonthlyWeek { week_start: string; readings: number; avg_systolic: number | null; avg_diastolic: number | null }
export interface MonthlyPayload {
  month: string;
  readings: number;
  days_logged: number;
  enough_readings: boolean;
  minimum_readings: number;
  target: { systolic: number; diastolic: number; source: "patient" | "default" };
  average: { systolic: number; diastolic: number; versus_target: "under" | "above" } | null;
  weeks: MonthlyWeek[];
  direction_vs_last_month: "lower" | "higher" | "similar" | "not_enough_data";
  adherence_pct: number | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === "string";
const numOrNull = (x: unknown): number | null | undefined => (x === null ? null : num(x) ? x : undefined);

export function parseMonthlyPayload(x: unknown): MonthlyPayload | null {
  if (!isObj(x)) return null;
  const tg = x["target"];
  if (!isObj(tg) || !num(tg["systolic"]) || !num(tg["diastolic"]) || (tg["source"] !== "patient" && tg["source"] !== "default")) return null;
  let average: MonthlyPayload["average"] = null;
  const av = x["average"];
  if (av !== null && av !== undefined) {
    if (!isObj(av) || !num(av["systolic"]) || !num(av["diastolic"]) || (av["versus_target"] !== "under" && av["versus_target"] !== "above")) return null;
    average = { systolic: av["systolic"], diastolic: av["diastolic"], versus_target: av["versus_target"] };
  }
  if (!Array.isArray(x["weeks"])) return null;
  const weeks: MonthlyWeek[] = [];
  for (const w of x["weeks"]) {
    if (!isObj(w) || !str(w["week_start"]) || !num(w["readings"])) return null;
    const s = numOrNull(w["avg_systolic"]);
    const d = numOrNull(w["avg_diastolic"]);
    if (s === undefined || d === undefined) return null;
    weeks.push({ week_start: w["week_start"], readings: w["readings"], avg_systolic: s, avg_diastolic: d });
  }
  const dir = x["direction_vs_last_month"];
  if (dir !== "lower" && dir !== "higher" && dir !== "similar" && dir !== "not_enough_data") return null;
  const adh = numOrNull(x["adherence_pct"]);
  if (!str(x["month"]) || !num(x["readings"]) || !num(x["days_logged"]) || typeof x["enough_readings"] !== "boolean" || !num(x["minimum_readings"]) || adh === undefined) return null;
  return {
    month: x["month"], readings: x["readings"], days_logged: x["days_logged"], enough_readings: x["enough_readings"], minimum_readings: x["minimum_readings"],
    target: { systolic: tg["systolic"], diastolic: tg["diastolic"], source: tg["source"] }, average, weeks, direction_vs_last_month: dir, adherence_pct: adh,
  };
}

const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** "September 2026" from "2026-09-01". Dates are Lagos calendar dates, so no timezone shift is applied. */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}
function weekLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export interface MonthlyReportView { month: string; monthLabel: string; headline: string; lines: string[]; weeks: string[]; enough: boolean }

export function buildMonthlyView(p: MonthlyPayload, locale: Locale): MonthlyReportView {
  const label = monthLabel(p.month);
  const lines: string[] = [t("progress.readings", locale, { count: p.readings, days: p.days_logged })];
  if (p.enough_readings && p.average) {
    lines.push(t("progress.average", locale, { sys: n1(p.average.systolic), dia: n1(p.average.diastolic) }));
    lines.push(t(p.average.versus_target === "under" ? "progress.versus_under" : "progress.versus_above", locale));
  } else {
    lines.push(t("progress.not_enough", locale, { count: p.readings }));
  }
  lines.push(t(p.target.source === "patient" ? "progress.target_set" : "progress.target_default", locale, { sys: p.target.systolic, dia: p.target.diastolic }));
  const dir = {
    lower: "progress.direction_lower",
    higher: "progress.direction_higher",
    similar: "progress.direction_similar",
    not_enough_data: "progress.direction_none",
  } as const;
  lines.push(t(dir[p.direction_vs_last_month], locale));
  // Adherence is its own sentence, never folded into the blood pressure lines (Module 22.2).
  lines.push(p.adherence_pct === null ? t("progress.adherence_none", locale) : t("progress.adherence", locale, { pct: p.adherence_pct }));
  const weeks = p.weeks.map((w) =>
    w.avg_systolic !== null && w.avg_diastolic !== null
      ? t("progress.week_row", locale, { date: weekLabel(w.week_start), sys: n1(w.avg_systolic), dia: n1(w.avg_diastolic), count: w.readings })
      : t("progress.week_few", locale, { date: weekLabel(w.week_start), count: w.readings }),
  );
  return { month: p.month, monthLabel: label, headline: t("progress.subtitle", locale, { month: label }), lines, weeks, enough: p.enough_readings };
}

/** Parse the list from `my_monthly_reports`; a payload that does not match is dropped, not rendered half-way. */
export function parseMonthlyList(data: unknown, locale: Locale): MonthlyReportView[] {
  if (!Array.isArray(data)) return [];
  const out: MonthlyReportView[] = [];
  for (const row of data) {
    if (!isObj(row)) continue;
    const p = parseMonthlyPayload(row["payload"]);
    if (p) out.push(buildMonthlyView(p, locale));
  }
  return out;
}

/**
 * What a Care Circle member sees of one month (S38d). Each part is present only if the patient ticked the matching permission:
 * `average`, `enough_readings` and `direction` come with weekly_bp_trend; `adherence_pct` with adherence_summary. A missing part means
 * "not shared", never "zero". There are no target numbers, week split or reading counts here.
 */
export interface CircleMonthlyRow {
  month: string;
  enough_readings?: boolean;
  average?: { systolic: number; diastolic: number; versus_target: "under" | "above" };
  direction?: "lower" | "higher" | "similar" | "not_enough_data";
  adherence_pct?: number | null;
  adherence_shared?: boolean;
}

export function parseCircleMonthly(data: unknown): CircleMonthlyRow[] {
  if (!Array.isArray(data)) return [];
  const out: CircleMonthlyRow[] = [];
  for (const r of data) {
    if (!isObj(r) || !str(r["month"])) continue;
    const row: CircleMonthlyRow = { month: r["month"] };
    if (typeof r["enough_readings"] === "boolean") row.enough_readings = r["enough_readings"];
    const a = r["average"];
    if (isObj(a) && num(a["systolic"]) && num(a["diastolic"]) && (a["versus_target"] === "under" || a["versus_target"] === "above")) {
      row.average = { systolic: a["systolic"], diastolic: a["diastolic"], versus_target: a["versus_target"] };
    }
    const d = r["direction"];
    if (d === "lower" || d === "higher" || d === "similar" || d === "not_enough_data") row.direction = d;
    if (r["adherence_shared"] === true) {
      row.adherence_shared = true;
      row.adherence_pct = num(r["adherence_pct"]) ? r["adherence_pct"] : null;
    }
    out.push(row);
  }
  return out;
}

/** One short line per part the supporter may see for a month. */
export function circleMonthlyLines(r: CircleMonthlyRow, locale: Locale): string[] {
  const label = monthLabel(r.month);
  const lines: string[] = [];
  if (r.enough_readings === true && r.average) {
    const versus = t(r.average.versus_target === "under" ? "circle.view.monthly.under" : "circle.view.monthly.above", locale);
    lines.push(t("circle.view.monthly.row_bp", locale, { month: label, systolic: r.average.systolic, diastolic: r.average.diastolic, versus }));
    if (r.direction && r.direction !== "not_enough_data") lines.push(t(`circle.view.monthly.${r.direction}`, locale));
  } else if (r.enough_readings === false) {
    lines.push(t("circle.view.monthly.not_enough", locale, { month: label }));
  }
  if (r.adherence_shared) {
    lines.push(r.adherence_pct === null || r.adherence_pct === undefined
      ? t("circle.view.monthly.adherence_none", locale, { month: label })
      : t("circle.view.monthly.adherence", locale, { month: label, percent: r.adherence_pct }));
  }
  return lines;
}
