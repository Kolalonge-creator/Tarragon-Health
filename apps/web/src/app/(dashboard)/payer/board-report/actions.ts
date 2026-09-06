"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string; reportId?: string } | undefined;

const generateSchema = z
  .object({
    insurerId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "The period ends before it starts",
    path: ["periodEnd"],
  });

/**
 * Every rule that matters — who may generate, that the period has closed,
 * which measures are in force, the suppression floor, the hash — lives in
 * `generate_payer_board_report`, not here. This action validates shape and
 * forwards. Duplicating any of that logic in TypeScript would give a reader
 * two places to check and one of them would eventually be wrong.
 */
export async function generateBoardReportAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = generateSchema.safeParse({
    insurerId: formData.get("insurerId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_payer_board_report", {
    p_insurer_id: parsed.data.insurerId,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
  });
  if (error) return { error: error.message };

  const result = data as { report_id?: string; report_number?: string } | null;
  revalidatePath("/payer/board-report");
  return {
    message: `Report ${result?.report_number ?? ""} generated as a draft. It needs a Tarragon attestation before it can be presented as final.`,
    reportId: result?.report_id,
  };
}

const attestSchema = z.object({
  reportId: z.string().uuid(),
  statement: z.string().trim().min(20, "Say what is being attested to — at least a sentence"),
  roleTitle: z.string().trim().min(2, "Give the signatory's role").max(120),
});

export async function attestBoardReportAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = attestSchema.safeParse({
    reportId: formData.get("reportId"),
    statement: formData.get("statement"),
    roleTitle: formData.get("roleTitle"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("attest_payer_board_report", {
    p_report_id: parsed.data.reportId,
    p_statement: parsed.data.statement,
    p_role_title: parsed.data.roleTitle,
  });
  if (error) return { error: error.message };

  revalidatePath(`/payer/board-report/${parsed.data.reportId}`);
  revalidatePath("/payer/board-report");
  return { message: "Attested. This report can now be presented as final." };
}

const withdrawSchema = z.object({
  reportId: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a reason — anyone verifying a copy will see it"),
});

export async function withdrawBoardReportAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = withdrawSchema.safeParse({
    reportId: formData.get("reportId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_payer_board_report", {
    p_report_id: parsed.data.reportId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/payer/board-report/${parsed.data.reportId}`);
  revalidatePath("/payer/board-report");
  return { message: "Withdrawn. Copies already in circulation will now verify as withdrawn." };
}
