import { supabase } from "./supabase";

/**
 * Numbers read from a report the person uploaded themselves, for them to check and confirm (database: my_lab_report_drafts and
 * confirm_my_lab_report). Confirming puts them on the person's own chart, marked as reported by them; a doctor has not checked them.
 * The database re-checks everything here (own report only, no sensitive results, no future date, sane values); this only gives the form
 * a clear message first and builds exactly what the person sees.
 */
export interface ReportedDraftRow {
  code: string;
  label: string;
  value: number;
  unit: string | null;
}

export interface ReportedDraft {
  documentId: string;
  extractionId: string;
  filename: string | null;
  reportDate: string | null;
  confirmed: boolean;
  rows: ReportedDraftRow[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportedDrafts(data: unknown): ReportedDraft[] {
  if (!Array.isArray(data)) return [];
  const out: ReportedDraft[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw.extraction_id !== "string" || typeof raw.document_id !== "string" || !Array.isArray(raw.rows)) continue;
    const rows: ReportedDraftRow[] = [];
    for (const r of raw.rows as Record<string, unknown>[]) {
      if (!r || typeof r.code !== "string") continue;
      // a blank or boolean is not a number (Number("") is 0 and would show as a real result)
      const v = r.value;
      const value = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN;
      if (!Number.isFinite(value)) continue;
      rows.push({
        code: r.code,
        label: typeof r.label === "string" && r.label.trim() !== "" ? r.label : r.code,
        value,
        unit: typeof r.unit === "string" && r.unit.trim() !== "" ? r.unit : null,
      });
    }
    if (rows.length === 0) continue;
    out.push({
      documentId: raw.document_id,
      extractionId: raw.extraction_id,
      filename: typeof raw.filename === "string" ? raw.filename : null,
      reportDate: typeof raw.report_date === "string" && ISO_DATE.test(raw.report_date) ? raw.report_date : null,
      confirmed: raw.confirmed === true,
      rows,
    });
  }
  return out;
}

export type ConfirmReason = "date" | "value";

export type ConfirmPlan =
  | { ok: true; args: { p_extraction_id: string; p_readings: { code: string; value: number; unit: string | null }[]; p_report_date: string } }
  | { ok: false; reason: ConfirmReason };

/** What to send for one draft: the date on the report and every number as the person has it on screen (their correction included). */
export function planReportedConfirm(draft: ReportedDraft, values: Record<string, string>, reportDate: string): ConfirmPlan {
  const date = reportDate.trim();
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date)) || date < "1990-01-01") return { ok: false, reason: "date" };
  const readings: { code: string; value: number; unit: string | null }[] = [];
  for (const r of draft.rows) {
    const text = (values[r.code] ?? "").trim();
    const value = text === "" ? NaN : Number(text);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return { ok: false, reason: "value" };
    readings.push({ code: r.code, value, unit: r.unit });
  }
  return { ok: true, args: { p_extraction_id: draft.extractionId, p_readings: readings, p_report_date: date } };
}

/** The drafts waiting for this person. A failed read is an empty list, never an error on screen: this card is an extra, not the screen. */
export async function loadReportedDrafts(): Promise<ReportedDraft[]> {
  const { data, error } = await supabase.rpc("my_lab_report_drafts");
  return error ? [] : parseReportedDrafts(data);
}

export async function confirmReportedDraft(args: Extract<ConfirmPlan, { ok: true }>["args"]): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("confirm_my_lab_report", args);
  if (!error) return { ok: true };
  // 22023 messages are written for people ("give the date printed on the report"); anything else is never shown raw
  return { ok: false, message: error.code === "22023" && error.message ? error.message : "We could not save these numbers. Try again." };
}
