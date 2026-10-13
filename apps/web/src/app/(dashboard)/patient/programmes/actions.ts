"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const codeSchema = z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9 -]+$/);
const idSchema = z.string().uuid();
const BACK = "/patient/programmes";

function result(data: unknown): { ok: boolean; status: string | null; name: string | null } {
  if (typeof data !== "object" || data === null) return { ok: false, status: null, name: null };
  const d = data as Record<string, unknown>;
  return { ok: d.ok === true, status: typeof d.status === "string" ? d.status : null, name: typeof d.name === "string" ? d.name : null };
}

/** Enter a programme code. The database gives the same answer for an unknown, expired, closed or full code, and slows guessing. */
export async function joinProgrammeAction(formData: FormData): Promise<void> {
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) redirect(`${BACK}?m=code_invalid`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_cohort", { p_code: code.data });
  const r = result(data);
  if (error || !r.ok) redirect(`${BACK}?m=${error ? "error" : "code_invalid"}`);
  revalidatePath(BACK);
  redirect(`${BACK}?m=${r.status === "already" ? "already" : "joined"}`);
}

/** Turn sharing of group figures on or off for one programme. The database refuses "on" while no consent text is in force. */
export async function setSharingAction(formData: FormData): Promise<void> {
  const cohort = idSchema.safeParse(formData.get("cohortId"));
  const on = formData.get("on") === "1";
  if (!cohort.success) redirect(`${BACK}?m=error`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_cohort_reporting_consent", { p_cohort: cohort.data, p_granted: on });
  const reason = typeof data === "object" && data !== null && "reason" in data ? String((data as { reason: unknown }).reason) : null;
  if (error || !result(data).ok) redirect(`${BACK}?m=${reason === "not_available" ? "unavailable" : "error"}`);
  revalidatePath(BACK);
  redirect(`${BACK}?m=saved`);
}

export async function leaveProgrammeAction(formData: FormData): Promise<void> {
  const cohort = idSchema.safeParse(formData.get("cohortId"));
  if (!cohort.success) redirect(`${BACK}?m=error`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_cohort", { p_cohort: cohort.data });
  if (error || !result(data).ok) redirect(`${BACK}?m=error`);
  revalidatePath(BACK);
  redirect(`${BACK}?m=saved`);
}
