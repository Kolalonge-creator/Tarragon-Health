"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpc, fdRpcData } from "@/lib/frontdesk/raw-db";

export type FrontDeskActionState = { error?: string; done?: string } | undefined;

async function requireSuperAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in";
  // The database re-checks private.is_admin(); this is the friendly message, not the gate.
  const { isSuperAdmin } = await getCallerPermissions();
  return isSuperAdmin ? null : "Only an admin can change this";
}

const switchSchema = z.object({ enabled: z.enum(["true", "false"]) });

/**
 * The kill switch. Off, every visitor sees the contact form instead of the assistant and nothing is stored by the assistant; an emergency
 * wording is still answered. On, the assistant answers again. Switching OFF is also open to delegated staff in the database; this page is admin only.
 */
export async function setAssistantSwitchAction(_prev: FrontDeskActionState, formData: FormData): Promise<FrontDeskActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = switchSchema.safeParse({ enabled: formData.get("enabled") });
  if (!parsed.success) return { error: "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "assistant_enabled", p_value: parsed.data.enabled === "true" });
  if (error) return { error };
  revalidatePath("/admin/front-desk");
  return { done: parsed.data.enabled === "true" ? "The assistant is on" : "The assistant is off. Visitors now see the contact form." };
}

const sampleSchema = z.object({ percent: z.enum(["0", "10", "25", "50", "100"]) });

/** How much ordinary traffic is put on the review queue. Flagged conversations and handoffs are always reviewed. 100 is the live pilot. */
export async function setSamplePercentAction(_prev: FrontDeskActionState, formData: FormData): Promise<FrontDeskActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = sampleSchema.safeParse({ percent: formData.get("percent") });
  if (!parsed.success) return { error: "Choose one of the listed shares" };
  const { error } = await fdRpc(await createClient(), "fd_set_config", { p_key: "review_sample_percent", p_value: Number(parsed.data.percent) });
  if (error) return { error };
  revalidatePath("/admin/front-desk");
  return { done: parsed.data.percent === "100" ? "Every conversation will be put on the review queue." : `${parsed.data.percent}% of ordinary conversations will be reviewed.` };
}

/** Makes a report for the seven days ending today, so it can be checked before the first Friday. It is emailed within a few minutes. */
export async function generateReportNowAction(_prev: FrontDeskActionState): Promise<FrontDeskActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const { data, error } = await fdRpcData<string>(await createClient(), "fd_report_generate_now");
  if (error) return { error };
  if (!data) return { error: "No report could be made" };
  revalidatePath("/admin/front-desk");
  return { done: "Report made. It will be emailed to you within a few minutes." };
}
