import { z } from "zod";
import { t, type Locale } from "@tarragon/i18n";

/**
 * The personal monthly progress report as the database stores it (S38c, Module 22.5). Parsed, never trusted: a payload that does
 * not match is skipped instead of half-rendered. The report holds numbers and keys only; every sentence comes from
 * packages/i18n so it can be read in English or Pidgin, and nothing here compares the person with anyone else.
 */
const week = z.object({
  week_start: z.string(),
  readings: z.number().int().nonnegative(),
  avg_systolic: z.number().nullable(),
  avg_diastolic: z.number().nullable(),
});

export const monthlyPayloadSchema = z.object({
  month: z.string(),
  readings: z.number().int().nonnegative(),
  days_logged: z.number().int().nonnegative(),
  enough_readings: z.boolean(),
  minimum_readings: z.number().int().positive(),
  target: z.object({ systolic: z.number(), diastolic: z.number(), source: z.enum(["patient", "default"]) }),
  average: z.object({ systolic: z.number(), diastolic: z.number(), versus_target: z.enum(["under", "above"]) }).nullable(),
  weeks: z.array(week),
  direction_vs_last_month: z.enum(["lower", "higher", "similar", "not_enough_data"]),
  adherence_pct: z.number().int().min(0).max(100).nullable(),
});
export type MonthlyPayload = z.infer<typeof monthlyPayloadSchema>;

export const monthlyListSchema = z.array(z.object({ month: z.string(), payload: z.unknown() }));

export interface MonthlyReportView {
  month: string;
  monthLabel: string;
  headline: string;
  lines: string[];
  weeks: string[];
  enough: boolean;
}

const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** "September 2026" from "2026-09-01". Dates are Lagos calendar dates, so no timezone shift is applied. */
export function monthLabel(month: string): string {
  const d = new Date(`${month}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function weekLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export function buildMonthlyView(p: MonthlyPayload, locale: Locale): MonthlyReportView {
  const label = monthLabel(p.month);
  const lines: string[] = [t("progress.readings", locale, { count: p.readings, days: p.days_logged })];
  if (p.enough_readings && p.average) {
    lines.push(t("progress.average", locale, { sys: n1(p.average.systolic), dia: n1(p.average.diastolic) }));
    lines.push(t(p.average.versus_target === "under" ? "progress.versus_under" : "progress.versus_above", locale));
  } else {
    lines.push(t("progress.not_enough", locale, { count: p.readings }));
  }
  lines.push(
    t(p.target.source === "patient" ? "progress.target_set" : "progress.target_default", locale, { sys: p.target.systolic, dia: p.target.diastolic }),
  );
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
  const list = monthlyListSchema.safeParse(data);
  if (!list.success) return [];
  const out: MonthlyReportView[] = [];
  for (const row of list.data) {
    const p = monthlyPayloadSchema.safeParse(row.payload);
    if (p.success) out.push(buildMonthlyView(p.data, locale));
  }
  return out;
}
