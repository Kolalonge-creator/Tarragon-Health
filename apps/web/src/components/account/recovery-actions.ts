"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Signed-in actions for the S03b recovery routes: making backup codes, naming a recovery contact, and (for the contact)
 * answering and confirming. Every one goes through a SECURITY DEFINER RPC that re-checks who is asking; nothing here trusts a
 * role or an id from the browser. The RPCs queue the in-app and email notices to the account owner.
 */

export type BackupCodesState = { codes?: string[]; error?: string } | undefined;
export type SimpleState = { ok?: boolean; error?: string } | undefined;

const GENERIC = "Something went wrong just then. Please try again.";
const uuid = z.string().uuid();

/** Ten new backup codes, shown once. Making new ones ends the old set at once. */
export async function generateBackupCodesAction(_prev: BackupCodesState, _formData: FormData): Promise<BackupCodesState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again, then retry." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_backup_codes");
  if (error) {
    if (/backup_codes_rate_limited/.test(error.message)) {
      return { error: "You have made backup codes several times today. Please try again tomorrow." };
    }
    return { error: GENERIC };
  }
  revalidatePath("/patient/profile");
  return { codes: data ?? [] };
}

type RpcOutcome = { ok?: boolean; error?: string } | null;

const CONTACT_ERRORS: Record<string, string> = {
  not_a_circle_member: "That person is not in your Care Circle any more. Pick someone who is.",
  already_set: "You already have a recovery contact. Remove them first if you want to choose someone else.",
  not_found: "That is no longer open. Refresh the page and try again.",
};

function outcome(data: unknown, error: unknown): SimpleState {
  if (error) return { error: GENERIC };
  const res = data as RpcOutcome;
  if (res?.ok === true) return { ok: true };
  return { error: CONTACT_ERRORS[String(res?.error)] ?? GENERIC };
}

/** The patient names ONE confirmed Care Circle member. The person has to agree before it counts. */
export async function proposeRecoveryContactAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const member = uuid.safeParse(formData.get("memberId"));
  if (!member.success) return { error: "Choose someone from your Care Circle." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_recovery_contact", { p_member: member.data });
  const res = outcome(data, error);
  if (res?.ok) revalidatePath("/patient/care-circle");
  return res;
}

/** Either side removes the arrangement. Also cancels any recovery waiting on it. */
export async function revokeRecoveryContactAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: GENERIC };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_recovery_contact", { p_id: id.data });
  const res = outcome(data, error);
  if (res?.ok) {
    revalidatePath("/patient/care-circle");
    revalidatePath("/patient/supporting");
  }
  return res;
}

/** The supporter says yes or no to being someone's recovery contact. */
export async function respondRecoveryContactAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const id = uuid.safeParse(formData.get("id"));
  const accept = formData.get("decision") === "accept";
  if (!id.success) return { error: GENERIC };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_recovery_contact", { p_id: id.data, p_accept: accept });
  const res = outcome(data, error);
  if (res?.ok) revalidatePath("/patient/supporting");
  return res;
}

/**
 * The contact confirms (or declines) that it is really the person who asked, in their OWN signed-in session. Confirming needs
 * the box ticked: it is a statement that they spoke to the person themselves. It starts a wait; the contact never receives a
 * link or a code.
 */
export async function confirmContactRecoveryAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const id = uuid.safeParse(formData.get("id"));
  const confirm = formData.get("decision") === "confirm";
  if (!id.success) return { error: GENERIC };
  if (confirm && formData.get("sure") !== "on") {
    return { error: "Only confirm if you have spoken to them yourself and are sure it is them. Tick the box to confirm." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_contact_recovery", { p_request: id.data, p_confirm: confirm });
  const res = outcome(data, error);
  if (res?.ok) revalidatePath("/patient/supporting");
  return res;
}

/** The patient, signed in anywhere, stops a recovery request that was not theirs. */
export async function cancelContactRecoveryAction(_prev: SimpleState, _formData: FormData): Promise<SimpleState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_contact_recovery");
  if (error) return { error: GENERIC };
  revalidatePath("/patient/care-circle");
  return { ok: true };
}
