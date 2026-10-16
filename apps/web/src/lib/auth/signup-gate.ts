import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loose } from "@/lib/clinician/loose-client";

export type SignupGate = { inviteOnly: boolean; allowed: boolean };

/**
 * Is sign-up invite-only right now, and would this person be let through? A kind pre-check only: the real gate is the database trigger on
 * auth.users, so if this cannot be answered (a failed call) it says "allowed" and lets the trigger decide, rather than blocking people on a
 * glitch. It answers yes or no and consumes nothing. The invite code is never logged or returned.
 */
export async function checkSignupGate(input: { phone?: string; email?: string; inviteCode?: string }): Promise<SignupGate> {
  try {
    const client = loose(createServiceRoleClient());
    const on = await client.rpc("platform_switch_is_on", { p_key: "signup_invites_required" });
    if (on.error || on.data !== true) return { inviteOnly: false, allowed: true };
    const gate = await client.rpc("signup_gate_status", {
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
      p_invite_code: input.inviteCode ?? null,
    });
    if (gate.error) return { inviteOnly: true, allowed: true };
    return { inviteOnly: true, allowed: gate.data === true };
  } catch {
    return { inviteOnly: false, allowed: true };
  }
}

/** For the sign-up page: show the invite code box only while it matters. Never throws. */
export async function isInviteOnlySignup(): Promise<boolean> {
  try {
    const on = await loose(createServiceRoleClient()).rpc("platform_switch_is_on", { p_key: "signup_invites_required" });
    return !on.error && on.data === true;
  } catch {
    return false;
  }
}
