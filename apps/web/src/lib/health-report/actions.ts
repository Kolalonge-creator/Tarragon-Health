"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { refreshHealthReportDraft } from "./build";

/**
 * Clinician actions for the yearly Health Report (S46). Everything is checked by the database as the signed-in clinician: the sign-off task and its claim (S16, INV-12),
 * the doctor-tier rule, the audit row (INV-10) and the honesty guard. These wrappers only validate input and translate the refusal into plain words.
 */

const signSchema = z.object({
  reportId: z.string().uuid(),
  summary: z.string().trim().min(1).max(2000),
  source: z.enum(["template", "clinician", "clinician_edited_ai_draft"]),
});
const correctSchema = z.object({ reportId: z.string().uuid(), note: z.string().trim().min(10).max(500) });

export interface HealthReportActionResult {
  readonly ok: boolean;
  readonly error?: "invalid" | "not_allowed" | "sensitive_wording" | "not_waiting" | "failed";
}

function classify(message: string): HealthReportActionResult["error"] {
  if (message.includes("not_authorised")) return "not_allowed";
  if (message.includes("health_report_honesty")) return "sensitive_wording";
  if (message.includes("not_waiting_for_signature") || message.includes("draft_already_waiting")) return "not_waiting";
  return "failed";
}

export async function signHealthReportAction(input: z.input<typeof signSchema>): Promise<HealthReportActionResult> {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_health_report", { p_id: parsed.data.reportId, p_summary: parsed.data.summary, p_summary_source: parsed.data.source });
  if (error) return { ok: false, error: classify(error.message) };
  revalidatePath("/clinician/health-reports");
  return { ok: true };
}

export async function correctHealthReportAction(input: z.input<typeof correctSchema>): Promise<HealthReportActionResult & { reportId?: string }> {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  // read the signed report first: the new draft is routed as a task, so its author no longer holds it and could not read it back
  const { data: row } = await supabase.rpc("clinician_get_health_report", { p_id: parsed.data.reportId });
  const { data: newId, error } = await supabase.rpc("correct_health_report", { p_id: parsed.data.reportId, p_note: parsed.data.note });
  if (error || !newId) return { ok: false, error: classify(error?.message ?? "") };
  // the new version starts as a copy; refill it with the current facts so a corrected result actually shows (best effort: the clinician can still edit and sign)
  if (row?.patient_id) await refreshHealthReportDraft(createServiceRoleClient(), { reportId: newId as string, patientId: row.patient_id, year: row.year });
  revalidatePath("/clinician/health-reports");
  return { ok: true, reportId: newId as string };
}

const handBackSchema = z.object({ taskId: z.string().uuid(), reason: z.enum(["needs_information", "outside_competence", "conflict_of_interest", "technical_problem"]) });

/** Hands a sign-off task back to the queue through the standard S17 function (reason code only; the queue logs, audits and reviews it). */
export async function handBackReportTaskAction(input: z.input<typeof handBackSchema>): Promise<HealthReportActionResult> {
  const parsed = handBackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("queue_handback", { p_task: parsed.data.taskId, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/clinician/health-reports");
  return { ok: true };
}
