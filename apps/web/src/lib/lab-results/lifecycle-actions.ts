"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { refusalOf } from "@/lib/lab-results/structured";
import { describeLifecycleError, reviewContextSchema, trendNoteSchema, type ReviewContext } from "@/lib/lab-results/lifecycle";

export type LifecycleActionState = { error?: string; success?: boolean } | undefined;

const UUID = /^[0-9a-f-]{36}$/;
const CONTEXT_REASON = "Reviewing a lab result held for my review: status, change since the last value and the clock";

/** The called or backup clinician (or the CMO) acknowledges a critical value call. The database checks who they are. */
export async function acknowledgeCriticalCall(callId: string): Promise<LifecycleActionState> {
  if (!UUID.test(callId)) return { error: "That call could not be found." };
  const supabase = await createClient();
  const { data, error } = await loose(supabase).rpc("acknowledge_lab_critical_call", { p_call: callId });
  if (error) return { error: describeLifecycleError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  if (data && typeof data === "object" && "error" in data && (data as { error: unknown }).error === "closed") {
    return { error: "That call is already closed." };
  }
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

/**
 * Status, delta flags, the clock and the call for one result the clinician has just opened. An audited, tied read, on a click
 * (INV-10): never a side effect of loading the page.
 */
export async function openReviewContext(resultId: string): Promise<{ context?: ReviewContext; error?: string }> {
  if (!UUID.test(resultId)) return { error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await loose(supabase).rpc("lab_result_review_context", { p_result: resultId, p_reason: CONTEXT_REASON });
  if (error) return { error: describeLifecycleError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  const parsed = reviewContextSchema.safeParse(data);
  return parsed.success ? { context: parsed.data } : { error: "That could not be read. Please try again." };
}

/** A tied clinician writes a short note the patient will see beside one released numeric value. Plain words, written by a person. */
export async function writeTrendNote(_prev: LifecycleActionState, formData: FormData): Promise<LifecycleActionState> {
  const parsed = trendNoteSchema.safeParse({
    resultId: String(formData.get("result_id") ?? ""),
    analyte: String(formData.get("analyte") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await loose(supabase).rpc("write_lab_trend_note", {
    p_result: parsed.data.resultId,
    p_analyte: parsed.data.analyte,
    p_note: parsed.data.note,
  });
  if (error) return { error: describeLifecycleError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}
