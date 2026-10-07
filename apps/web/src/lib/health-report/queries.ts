import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseReportConfig } from "./build";
import type { ReportRow } from "./render-model";
import type { HealthReportConfig } from "@tarragon/clinical";

/**
 * Reads a signed yearly report as the signed-in patient. Row level security returns a row only when `status = 'signed'` and `signed_by` is set, so an unsigned
 * draft cannot be reached through this function whatever id is passed (spec acceptance test: "Health Report is not visible until signed").
 */
export interface SignedReport {
  readonly id: string;
  readonly row: ReportRow;
  readonly config: HealthReportConfig;
}

export async function listSignedReports(supabase: SupabaseClient<Database>): Promise<{ id: string; year: number; version: number }[]> {
  const { data } = await supabase.from("health_reports").select("id, year, version").order("year", { ascending: false }).order("version", { ascending: false });
  return data ?? [];
}

export async function getSignedReport(supabase: SupabaseClient<Database>, id?: string): Promise<SignedReport | null> {
  let q = supabase
    .from("health_reports")
    .select("id, year, version, composed, summary_text, signer_name, signer_registration, signed_at, correction_note, config_version_id");
  q = id ? q.eq("id", id) : q.order("year", { ascending: false }).order("version", { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  if (!data || !data.summary_text || !data.signer_name || !data.signer_registration || !data.signed_at) return null;
  const { data: cfg } = await supabase.from("health_report_config_versions").select("config").eq("id", data.config_version_id).maybeSingle();
  if (!cfg) return null;
  return {
    id: data.id,
    config: parseReportConfig(cfg.config),
    row: {
      year: data.year,
      version: data.version,
      composed: data.composed as unknown as ReportRow["composed"],
      summary_text: data.summary_text,
      signer_name: data.signer_name,
      signer_registration: data.signer_registration,
      signed_at: data.signed_at,
      correction_note: data.correction_note,
    },
  };
}
