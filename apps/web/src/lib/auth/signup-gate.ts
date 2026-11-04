import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loose } from "@/lib/clinician/loose-client";

export type SignupGate = { inviteOnly: boolean; allowed: boolean };

/**
 * Is sign-up invite-only right now, and would this person be let through? A kind pre-check only: the real gate is the database trigger on
 * auth.users, so if this cannot be answered (a failed call) it says "allowed" and lets the trigger decide, rather than blocking people on a
 * glitch. It answers yes or no and consumes nothing. The invite code is never logged or returned.
 */
export async function checkSignupGate(input: { phone?: string; email?: string; inviteCode?: string; supporter?: boolean }): Promise<SignupGate> {
  try {
    const client = loose(createServiceRoleClient());
    const on = await client.rpc("platform_switch_is_on", { p_key: "signup_invites_required" });
    if (on.error || on.data !== true) return { inviteOnly: false, allowed: true };
    // A supporter-only sign-up is also let through by a pending Care Circle invite to the same contact (private.signup_circle_invite_ok).
    const gate = await client.rpc(input.supporter ? "signup_gate_status_supporter" : "signup_gate_status", {
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

/**
 * For the sign-up page: show the invite code box only while it matters. Never throws.
 *
 * The box matters only while the switch is on AND an uninvited person is still refused. Once the
 * public_signup_enabled go-live guard is on, private.signup_permitted says yes to everyone, so the
 * box would only confuse the public; signup_gate_status with no phone, email or code is exactly
 * that "uninvited stranger" question (no invite or reservation can match an empty identity).
 */
export async function isInviteOnlySignup(): Promise<boolean> {
  try {
    const client = loose(createServiceRoleClient());
    const on = await client.rpc("platform_switch_is_on", { p_key: "signup_invites_required" });
    if (on.error || on.data !== true) return false;
    const stranger = await client.rpc("signup_gate_status", { p_phone: null, p_email: null, p_invite_code: null });
    if (stranger.error) return true;
    return stranger.data !== true;
  } catch {
    return false;
  }
}
