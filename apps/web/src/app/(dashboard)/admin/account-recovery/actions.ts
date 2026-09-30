"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ERROR_COPY,
  executeSchema,
  rejectSchema,
  requestIdSchema,
  requestSchema,
  searchSchema,
  simSwapSchema,
  type ActionResult,
} from "./schemas";

const GENERIC = "Something went wrong. Nothing was changed that you need to undo; please try again.";

async function requireAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.role === "admin";
}

function first(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Check the details and try again.";
}

type RpcJson = { ok?: boolean; error?: string; [k: string]: unknown } | null;

function fromRpc(data: RpcJson, error: unknown): ActionResult {
  if (error || !data) return { ok: false, error: GENERIC };
  if (data.ok === true) return { ok: true };
  return { ok: false, error: ERROR_COPY[String(data.error)] ?? GENERIC };
}

/** Uses the audited S02 search: minimal fields, reason logged, query text never stored. */
export async function searchRecoverySubjects(
  input: unknown,
): Promise<ActionResult<{ results: { id: string; fullName: string; patientNumber: string | null; phoneMasked: string }[] }>> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients_audited", { p_query: parsed.data.query, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: GENERIC };
  return {
    ok: true,
    results: (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name, patientNumber: r.patient_number, phoneMasked: r.phone_masked })),
  };
}

export async function requestRecovery(input: unknown): Promise<ActionResult<{ requestId: string; simSwapRisk: boolean }>> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_assisted_recovery", {
    p_subject: parsed.data.subjectId,
    p_reason: parsed.data.reason,
    p_identity_checks: parsed.data.identityChecks,
    p_method: parsed.data.method,
  });
  const res = data as RpcJson;
  if (error || !res) return { ok: false, error: GENERIC };
  if (res.ok !== true) return { ok: false, error: ERROR_COPY[String(res.error)] ?? GENERIC };
  revalidatePath("/admin/account-recovery");
  return { ok: true, requestId: String(res.request_id), simSwapRisk: res.sim_swap_risk === true };
}

export async function confirmSimSwapReview(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = simSwapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_sim_swap_review", { p_request: parsed.data.requestId, p_note: parsed.data.note });
  const out = fromRpc(data as RpcJson, error);
  if (out.ok) revalidatePath("/admin/account-recovery");
  return out;
}

export async function approveRecovery(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_assisted_recovery", { p_request: parsed.data.requestId });
  const out = fromRpc(data as RpcJson, error);
  if (out.ok) revalidatePath("/admin/account-recovery");
  return out;
}

export async function rejectRecovery(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_assisted_recovery", { p_request: parsed.data.requestId, p_reason: parsed.data.reason });
  const out = fromRpc(data as RpcJson, error);
  if (out.ok) revalidatePath("/admin/account-recovery");
  return out;
}

/**
 * The execute step. The database marks the request executed (and audits it); this function then makes the one Auth call.
 * Design rules, each covered by actions.test.ts:
 *  - No password is ever set and no link or code is ever returned to the caller.
 *  - Email method: Supabase itself emails the recovery link to the address ON FILE, read here from Auth. The admin cannot
 *    supply an address, and the link never passes through this server (resetPasswordForEmail, not generateLink).
 *  - Phone method: the new number is set UNCONFIRMED, so nothing is treated as verified until the owner of that number
 *    proves control with a code through the normal sign-in flow.
 *  - Failures are recorded as a bare failed outcome and surfaced as a generic message (no provider text leaks).
 */
export async function executeRecovery(input: unknown): Promise<ActionResult<{ next: string }>> {
  if (!(await requireAdmin())) return { ok: false, error: ERROR_COPY.not_authorised };
  const parsed = executeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: first(parsed.error.issues) };
  const { requestId, newPhone } = parsed.data;

  const supabase = await createClient();
  // Refuse before anything is marked executed: a phone recovery with no new number would otherwise burn the request.
  const { data: pre } = await supabase.from("account_recovery_requests").select("method").eq("id", requestId).maybeSingle();
  if (pre?.method === "new_phone_reverification" && !newPhone) {
    return { ok: false, error: "Enter the new phone number before running this step." };
  }
  const { data, error } = await supabase.rpc("execute_assisted_recovery", { p_request: requestId });
  const res = data as RpcJson;
  if (error || !res) return { ok: false, error: GENERIC };
  if (res.ok !== true) return { ok: false, error: ERROR_COPY[String(res.error)] ?? GENERIC };

  const method = String(res.method);
  const subjectId = String(res.subject_user_id);
  // Nothing here carries an address, number, request id or provider text: only which step failed, so a failure is
  // visible to us instead of swallowed, and never leaks what it was about.
  const report = (step: string) => Sentry.captureMessage(`assisted recovery: ${step}`, { level: "error", tags: { method } });
  const record = async (ok: boolean): Promise<boolean> => {
    const { data: out, error: outErr } = await supabase.rpc("record_assisted_recovery_outcome", { p_request: requestId, p_ok: ok });
    const recorded = !outErr && (out as RpcJson)?.ok === true;
    if (!recorded) report("outcome could not be recorded");
    revalidatePath("/admin/account-recovery");
    return recorded;
  };
  const failed = async (step: string): Promise<ActionResult<{ next: string }>> => {
    report(step);
    await record(false);
    return {
      ok: false,
      error: "The request was approved and marked done, but we could not complete the sign-in step. Start a new request to try again.",
    };
  };

  try {
    const admin = createServiceRoleClient();
    if (method === "email_link_to_verified_email") {
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(subjectId);
      const email = u?.user?.email;
      if (uErr || !email || !u?.user?.email_confirmed_at) return await failed("no verified email on the account");
      const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
      const { error: sendErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
      if (sendErr) return await failed("recovery email was not sent");
      const recorded = await record(true);
      if (!recorded) return { ok: true, next: "We emailed a recovery link to the address on file, but could not save that note against the request. Tell the account owner to check their email." };
      return { ok: true, next: "We emailed a recovery link to the address on file. They can now reset their own password from it." };
    }
    if (method === "new_phone_reverification") {
      if (!newPhone) return await failed("no new phone number");
      const { error: upErr } = await admin.auth.admin.updateUserById(subjectId, { phone: newPhone, phone_confirm: false });
      if (upErr) return await failed("new phone number was not saved");
      const recorded = await record(true);
      if (!recorded) return { ok: true, next: "The new number is saved as unverified, but we could not save that note against the request. The account owner must sign in with the code sent to that number." };
      return { ok: true, next: "The new number is saved as unverified. The account owner must sign in with the code sent to that number before it is used." };
    }
    return await failed("unknown method");
  } catch {
    return await failed("the Auth step threw");
  }
}
