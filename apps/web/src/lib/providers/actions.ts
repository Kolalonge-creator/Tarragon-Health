"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { closeStatusSchema, idSchema, reasonSchema } from "./model";

/**
 * The two writes on the provider board. Both are audited admin-only database functions; these actions check the role first for a clear
 * result and send the outcome back as one fixed word in the address (never free text). Closing a break NEVER posts anything: it only
 * records that a person looked and what they found. Replay re-runs the handler for a verified event; it cannot touch a rejected one.
 */
const PATH = "/admin/ops/providers";
type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
const back = (result: "ok" | "failed" | "busy" | "invalid"): never => redirect(`${PATH}?r=${result}`);

export async function closeBreakAction(form: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") return back("failed");
  const id = idSchema.safeParse(form.get("break_id"));
  const status = closeStatusSchema.safeParse(form.get("status"));
  const note = reasonSchema.safeParse(form.get("note"));
  if (!id.success || !status.success || !note.success) return back("invalid");
  const supabase = (await createClient()) as unknown as Rpc;
  const { data, error } = await supabase.rpc("close_reconciliation_break", { p_id: id.data, p_status: status.data, p_note: note.data });
  revalidatePath(PATH);
  if (error || data !== true) return back("failed");
  return back("ok");
}

export async function replayProviderEventAction(form: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") return back("failed");
  const id = idSchema.safeParse(form.get("event_id"));
  const reason = reasonSchema.safeParse(form.get("reason"));
  if (!id.success || !reason.success) return back("invalid");
  const supabase = (await createClient()) as unknown as Rpc;
  const { data, error } = await supabase.rpc("replay_provider_event", { p_id: id.data, p_reason: reason.data });
  revalidatePath(PATH);
  if (error?.message.includes("provider_event_in_flight")) return back("busy");
  if (error || data !== true) return back("failed");
  return back("ok");
}
