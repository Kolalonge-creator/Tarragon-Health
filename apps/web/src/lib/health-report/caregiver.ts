import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import type { HealthReportConfig } from "@tarragon/clinical";
import { parseReportConfig } from "./build";
import type { CaregiverView, ReportRow } from "./render-model";

/**
 * A caregiver's or guardian's read of a dependant's SIGNED yearly report (S46c). Every decision is made in the database
 * (`caregiver_health_report`, written fresh on the access categories): the grant, the reproductive and mental health gates, the hand-over at 18 and
 * the withholding of sections. This file only parses what comes back. A refusal of any kind is the same "not found", so nothing here can say why.
 */
const responseSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  first_name: z.string(),
  year: z.number(),
  version: z.number(),
  config_version_id: z.string().uuid(),
  summary_text: z.string().nullable(),
  summary_withheld: z.boolean(),
  signer_name: z.string(),
  signer_registration: z.string(),
  signed_at: z.string(),
  correction_note: z.string().nullable(),
  withheld: z.array(z.string()),
  composed: z.record(z.string(), z.unknown()),
});

/** A caregiver sees the blood pressure target number but never the reason it is lower (that would reveal a higher-risk group to someone who may only hold vitals access). */
export function neutraliseTargets(c: ReportRow["composed"]): ReportRow["composed"] {
  return { ...c, items: (c.items ?? []).map((i) => (i.target && i.target.source === "higher_risk" ? { ...i, target: { ...i.target, source: "report_settings" as const } } : i)) };
}

export interface CaregiverReport {
  readonly id: string;
  readonly firstName: string;
  readonly row: ReportRow;
  readonly config: HealthReportConfig;
  readonly caregiver: CaregiverView;
}

export interface CaregiverReportListItem {
  readonly patientId: string;
  readonly firstName: string;
  readonly year: number;
  readonly version: number;
}

export async function listCaregiverReports(supabase: SupabaseClient<Database>): Promise<CaregiverReportListItem[]> {
  const { data, error } = await supabase.rpc("caregiver_report_list");
  if (error || !data) return [];
  return data.map((r) => ({ patientId: r.patient_id, firstName: r.first_name, year: r.year, version: r.version }));
}

export async function getCaregiverReport(supabase: SupabaseClient<Database>, patientId: string): Promise<CaregiverReport | null> {
  const { data, error } = await supabase.rpc("caregiver_health_report", { p_patient: patientId });
  if (error || !data) return null;
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) return null;
  const r = parsed.data;
  const { data: cfg } = await supabase.from("health_report_config_versions").select("config").eq("id", r.config_version_id).maybeSingle();
  if (!cfg) return null;
  return {
    id: r.id,
    firstName: r.first_name,
    config: parseReportConfig(cfg.config),
    caregiver: { withheld: r.withheld, summaryWithheld: r.summary_withheld },
    row: {
      year: r.year,
      version: r.version,
      composed: neutraliseTargets(r.composed as unknown as ReportRow["composed"]),
      summary_text: r.summary_text ?? "",
      signer_name: r.signer_name,
      signer_registration: r.signer_registration,
      signed_at: r.signed_at,
      correction_note: r.correction_note,
    },
  };
}
