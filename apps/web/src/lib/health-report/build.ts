import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { composeHealthReport, type ComposedReport, type HealthReportConfig, type HealthReportFacts } from "@tarragon/clinical";

/**
 * Builds a yearly Tarragon Health Report draft (S46, function 3.15). The "health-report-build" service:
 *   1. the database collects the facts (released, non-sensitive results only; INV-03, INV-04),
 *   2. the pure composer in packages/clinical applies the honesty rules,
 *   3. the draft is written by the service-role-only writer, which refuses while the go-live guard is off (INV-14) and is checked again by the
 *      database honesty guard,
 *   4. an optional AI-drafted summary is held ONLY on the unsigned draft row (INV-11) and never reaches the patient.
 * The draft then waits in the clinician sign-off queue; it is invisible to the patient until a named clinician signs (RLS).
 */

const configSchema = z.object({
  maxPriorities: z.number().int().min(1),
  minBpReadings: z.number().int().min(1),
  minBpDays: z.number().int().min(1).optional(),
  bpTarget: z.object({ systolicBelow: z.number(), diastolicBelow: z.number() }),
  bpTargetHigherRisk: z.object({ systolicBelow: z.number(), diastolicBelow: z.number() }).optional(),
  bpHighNormalBand: z.object({ systolicFrom: z.number(), systolicBelow: z.number(), diastolicFrom: z.number(), diastolicBelow: z.number() }).optional(),
  changeTolerancePct: z.number().min(0),
  recheckWeeks: z.number().int().min(1),
  priorityWindows: z.object({ bp: z.string(), lab: z.string(), screening: z.string(), risk: z.string() }),
  trendMinPoints: z.number().int().min(2),
  trendYears: z.number().int().min(1),
  statementKey: z.string(),
  statementApprovedByCmo: z.boolean(),
  shareExcludedSections: z.array(z.string()),
});

export function parseReportConfig(value: unknown): HealthReportConfig {
  return configSchema.parse(value);
}

export type BuildOutcome =
  | { status: "created"; reportId: string }
  | { status: "refused"; reason: "guard_off" | "settings_unsigned" | "draft_waiting" | "patient_not_found" | "no_settings" | "error"; detail?: string };

export type AiSummaryDrafter = (composed: ComposedReport, patientId: string) => Promise<string | null>;

/** Loads the settings the database will use: the signed active version, else (test patients only, enforced by the writer) the latest proposed one. */
async function loadConfig(service: SupabaseClient<Database>): Promise<HealthReportConfig | null> {
  const { data: active } = await service.from("health_report_config_versions").select("config").eq("is_active", true).maybeSingle();
  if (active?.config) return parseReportConfig(active.config);
  const { data: latest } = await service.from("health_report_config_versions").select("config").order("version", { ascending: false }).limit(1).maybeSingle();
  return latest?.config ? parseReportConfig(latest.config) : null;
}

export async function buildHealthReportDraft(
  service: SupabaseClient<Database>,
  params: { patientId: string; year: number; draftSummary?: AiSummaryDrafter },
): Promise<BuildOutcome> {
  const config = await loadConfig(service);
  if (!config) return { status: "refused", reason: "no_settings" };

  const { data: facts, error: collectError } = await service.rpc("health_report_collect", { p_patient: params.patientId, p_year: params.year });
  if (collectError || !facts) return { status: "refused", reason: "error", detail: collectError?.message };

  const composed = composeHealthReport(facts as unknown as HealthReportFacts, config);
  const templateSummary = t(composed.summary.key as Parameters<typeof t>[0], "en", composed.summary.params as Record<string, number>);

  let aiDraft: string | null = null;
  if (params.draftSummary) {
    try {
      aiDraft = await params.draftSummary(composed, params.patientId);
    } catch {
      aiDraft = null; // the template paragraph is the fallback; a failed draft never blocks a report
    }
  }

  const { data: id, error } = await service.rpc("record_health_report_draft", {
    p_patient: params.patientId,
    p_year: params.year,
    p_inputs: facts as Json,
    p_composed: { ...composed, templateSummary } as unknown as Json,
    p_priorities: composed.priorities as unknown as Json,
    p_ai_draft: aiDraft ?? undefined,
  });
  if (error || !id) {
    const msg = error?.message ?? "";
    if (msg.includes("not_live: yearly report generation")) return { status: "refused", reason: "guard_off" };
    if (msg.includes("not_live: the report settings")) return { status: "refused", reason: "settings_unsigned" };
    if (msg.includes("draft_already_waiting")) return { status: "refused", reason: "draft_waiting" };
    if (msg.includes("patient_not_found")) return { status: "refused", reason: "patient_not_found" };
    return { status: "refused", reason: "error", detail: msg };
  }
  return { status: "created", reportId: id as string };
}

/** Re-fills an unsigned correction draft with fresh facts (the corrected result), keeping its correction note and version link. */
export async function refreshHealthReportDraft(
  service: SupabaseClient<Database>,
  params: { reportId: string; patientId: string; year: number },
): Promise<boolean> {
  const config = await loadConfig(service);
  if (!config) return false;
  const { data: facts } = await service.rpc("health_report_collect", { p_patient: params.patientId, p_year: params.year });
  if (!facts) return false;
  const composed = composeHealthReport(facts as unknown as HealthReportFacts, config);
  const templateSummary = t(composed.summary.key as Parameters<typeof t>[0], "en", composed.summary.params as Record<string, number>);
  const { data } = await service.rpc("refresh_health_report_draft", {
    p_report: params.reportId,
    p_inputs: facts as Json,
    p_composed: { ...composed, templateSummary } as unknown as Json,
    p_priorities: composed.priorities as unknown as Json,
    p_ai_draft: undefined,
  });
  return data === true;
}
