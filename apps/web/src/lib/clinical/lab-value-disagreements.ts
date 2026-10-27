import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * DUP-1: the clinician-visible note when two reports of the same test and date disagree (a partner lab's structured result and a filed paper report).
 * Read through `public.lab_value_disagreements`, which ties the clinician to the patient, needs a reason and writes an audit row (INV-10, INV-12).
 * Both values are returned side by side; nothing here picks one. `denied` and `error` mean "could not be read", never "there is none".
 */
export interface LabValueDisagreement {
  code: string;
  reason: "value_differs" | "unit_differs";
  structured: { value: number; unit: string | null; at: string | null };
  paperReport: { value: number; unit: string | null; at: string | null };
}

export type LabValueDisagreementsResult =
  | { status: "ok"; rows: LabValueDisagreement[] }
  | { status: "denied" }
  | { status: "error"; message: string };

function side(v: unknown): { value: number; unit: string | null; at: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const value = typeof r.value === "number" ? r.value : typeof r.value === "string" ? Number(r.value) : NaN;
  if (!Number.isFinite(value)) return null;
  return { value, unit: typeof r.unit === "string" ? r.unit : null, at: typeof r.at === "string" ? r.at : null };
}

export function parseLabValueDisagreements(data: unknown): LabValueDisagreementsResult {
  if (!data || typeof data !== "object") return { status: "error", message: "unexpected response" };
  const j = data as Record<string, unknown>;
  if (j.denied === true) return { status: "denied" };
  if (!Array.isArray(j.disagreements)) return { status: "error", message: "unexpected response" };
  const rows: LabValueDisagreement[] = [];
  for (const d of j.disagreements) {
    if (!d || typeof d !== "object") return { status: "error", message: "malformed row" };
    const r = d as Record<string, unknown>;
    const structured = side(r.structured);
    const paperReport = side(r.paper_report);
    // a row that cannot show both values is an error, never silently dropped: the note exists to show the disagreement
    if (typeof r.code !== "string" || !structured || !paperReport || (r.reason !== "value_differs" && r.reason !== "unit_differs")) {
      return { status: "error", message: "malformed row" };
    }
    rows.push({ code: r.code, reason: r.reason, structured, paperReport });
  }
  return { status: "ok", rows };
}

export async function readLabValueDisagreements(
  supabase: SupabaseClient<Database>,
  patientId: string,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<LabValueDisagreementsResult> {
  const { data, error } = await supabase.rpc("lab_value_disagreements", { p_patient: patientId, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  return parseLabValueDisagreements(data);
}

export function disagreementLine(d: LabValueDisagreement): string {
  const fmt = (s: { value: number; unit: string | null }) => `${s.value}${s.unit ? " " + s.unit : ""}`;
  return `${d.code}: ${fmt(d.structured)} (laboratory result) and ${fmt(d.paperReport)} (filed report)${d.reason === "unit_differs" ? ", different units" : ""}`;
}
