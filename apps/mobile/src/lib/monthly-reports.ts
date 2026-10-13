import { parseMonthlyList, type Locale, type MonthlyReportView } from "@tarragon/i18n";
import { supabase } from "./supabase";

export type MonthlyReportsLoad = { ok: true; reports: MonthlyReportView[] } | { ok: false };

/**
 * The signed-in person's own monthly summaries (S38c). `my_monthly_reports` only ever returns the caller's rows, so this is never
 * used while acting for someone else. A failed read is reported as a failure, never as "no reports yet".
 */
export async function loadMonthlyReports(locale: Locale): Promise<MonthlyReportsLoad> {
  try {
    const { data, error } = await supabase.rpc("my_monthly_reports", { p_limit: 12 });
    if (error) return { ok: false };
    return { ok: true, reports: parseMonthlyList(data, locale) };
  } catch {
    return { ok: false };
  }
}
