"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpc, fdRpcData } from "@/lib/frontdesk/raw-db";

export type FollowUpActionState = { error?: string; done?: string } | undefined;

async function requireSuperAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in";
  // The database re-checks private.is_admin(); this is the friendly message, not the gate.
  const { isSuperAdmin } = await getCallerPermissions();
  return isSuperAdmin ? null : "Only an admin can change this";
}

const switchSchema = z.object({ enabled: z.enum(["true", "false"]) });

/** The master switch for follow-up email. Off stops the detector and the dispatcher; nothing is lost, runs wait. */
export async function setMasterSwitchAction(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = switchSchema.safeParse({ enabled: formData.get("enabled") });
  if (!parsed.success) return { error: "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "followups_enabled", p_value: parsed.data.enabled === "true" });
  if (error) return { error };
  revalidatePath("/admin/follow-ups");
  return { done: parsed.data.enabled === "true" ? "Follow-ups are on" : "Follow-ups are off" };
}

const basisSchema = z.object({ confirm: z.literal("on", { message: "Tick the box to confirm" }) });

/**
 * The DPO's confirmation that the sign-up terms cover account-setup emails (lawful basis: contract). Until it is given the detector creates no
 * account contact or consent, so nothing can be sent on an unconfirmed basis. Admin only and audited; there is deliberately no way to undo it
 * from here, because withdrawing it later is a legal decision to be taken with the DPO, not a switch.
 */
export async function confirmBasisAction(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = basisSchema.safeParse({ confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "account_followup_basis_confirmed", p_value: true });
  if (error) return { error };
  revalidatePath("/admin/follow-ups");
  return { done: "Confirmed. The next sweep (within 15 minutes) will find the people to follow up." };
}

/** The HubSpot sync switch. Off holds every CRM write in the outbox (nothing is lost); the function also needs its HubSpot token to deliver. */
export async function setHubspotSwitchAction(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = switchSchema.safeParse({ enabled: formData.get("enabled") });
  if (!parsed.success) return { error: "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "hubspot_enabled", p_value: parsed.data.enabled === "true" });
  if (error) return { error };
  revalidatePath("/admin/follow-ups");
  return { done: parsed.data.enabled === "true" ? "HubSpot sync is on" : "HubSpot sync is off" };
}

const goLiveSchema = z.object({ confirm: z.literal("on", { message: "Tick the box to confirm" }) });

/**
 * Takes follow-ups out of dry-run: real emails to real people. It refuses unless at least one email has been approved, then switches dry-run
 * off and re-arms what dry-run held back (only runs still fresh; anything overdue by 3 days stays skipped, so there is no stale flood).
 */
export async function goLiveAction(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = goLiveSchema.safeParse({ confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };

  const supabase = await createClient();
  const overview = await fdRpcData<{ approved_steps: number; followups_enabled: unknown; basis_confirmed: unknown }>(supabase, "fd_followup_overview");
  if (overview.error || !overview.data) return { error: "Could not read the current state, so nothing was changed. Reload and try again." };
  if (overview.data.approved_steps < 1) return { error: "No email has been approved yet, so there is nothing to send. Approve wording first." };
  if (overview.data.followups_enabled !== true) return { error: "Turn follow-ups on first." };
  if (overview.data.basis_confirmed !== true) return { error: "The DPO has not yet confirmed the lawful basis for account emails. Confirm it first." };

  const set = await fdRpc(supabase, "fd_set_config", { p_key: "followups_dry_run", p_value: false });
  if (set.error) return { error: set.error };
  const rearmed = await fdRpcData<number>(supabase, "fd_rearm_dry_run_runs");
  revalidatePath("/admin/follow-ups");
  if (rearmed.error) return { error: `Dry-run is off, but re-arming the held-back emails failed: ${rearmed.error}` };
  return { done: `Live. ${rearmed.data ?? 0} held-back email${rearmed.data === 1 ? "" : "s"} will go out at the next run (not between 21:00 and 07:00).` };
}

/** Back to dry-run: nothing is sent, everything is recorded. The quickest safe stop short of the master switch. */
export async function backToDryRunAction(): Promise<FollowUpActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "followups_dry_run", p_value: true });
  if (error) return { error };
  revalidatePath("/admin/follow-ups");
  return { done: "Back in dry-run: nothing will be sent" };
}
