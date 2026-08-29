"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type AgentActionState = { error?: string; message?: string } | undefined;

async function requireAgentsManage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

const recruitSchema = z.object({
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Enter a phone number in E.164 form, e.g. +2348012345678"),
  full_name: z.string().trim().min(2, "Enter the agent's full name"),
  community_affiliation: z.string().trim().optional(),
});

/**
 * Recruits an existing account (found by phone — the agent must already
 * have signed up as a patient, same as anyone else) as a community sales
 * agent. Deliberately does NOT create a new account: §12's non-technical
 * build is "recruit individuals with standing in a community" after an
 * off-platform agreement is signed, not a self-serve signup.
 */
export async function recruitAgentAction(
  _prev: AgentActionState,
  formData: FormData
): Promise<AgentActionState> {
  await requireAgentsManage();
  const parsed = recruitSchema.safeParse({
    phone: formData.get("phone"),
    full_name: formData.get("full_name"),
    community_affiliation: formData.get("community_affiliation") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("phone", parsed.data.phone)
    .maybeSingle();

  if (!existing) {
    return {
      error: "No account found with that phone number — the agent needs to sign up in the app first.",
    };
  }
  if (existing.role !== "patient") {
    return { error: "That account already has a staff or partner role and can't be made an agent." };
  }

  const { data, error } = await supabase.rpc("admin_create_community_agent", {
    p_profile_id: existing.id,
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone,
    p_community_affiliation: parsed.data.community_affiliation ?? null,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string; agent_code?: string };
  if (!result.ok) return { error: result.error ?? "Could not recruit this agent." };

  revalidatePath("/admin/settings/agents");
  return { message: `Recruited as ${result.agent_code}.` };
}

const payoutBatchSchema = z.object({
  period_start: z.string().min(1, "Choose a start date"),
  period_end: z.string().min(1, "Choose an end date"),
});

/** Batches every pending commission earned in the window into one payout
 * for a human to review and pay out (bank transfer, today) — see the
 * migration comment on why disbursement itself isn't automated yet. */
export async function createPayoutBatchAction(
  _prev: AgentActionState,
  formData: FormData
): Promise<AgentActionState> {
  await requireAgentsManage();
  const parsed = payoutBatchSchema.safeParse({
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid dates" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_agent_payout_batch", {
    p_period_start: parsed.data.period_start,
    p_period_end: parsed.data.period_end,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string; total_kobo?: number };
  if (!result.ok) return { error: result.error ?? "Could not create the batch." };

  revalidatePath("/admin/settings/agents");
  return { message: `Batch created — ₦${((result.total_kobo ?? 0) / 100).toLocaleString()} owed.` };
}

/** Marks a batch as paid once the actual bank transfers have gone out.
 * Recording, not disbursing — see admin_mark_payout_batch_paid's own
 * comment in the migration. */
export async function markPayoutBatchPaidAction(
  _prev: AgentActionState,
  formData: FormData
): Promise<AgentActionState> {
  await requireAgentsManage();
  const batchId = formData.get("batch_id");
  if (typeof batchId !== "string" || !batchId) {
    return { error: "Missing batch" };
  }
  const note = formData.get("note");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_mark_payout_batch_paid", {
    p_batch_id: batchId,
    p_note: typeof note === "string" && note ? note : null,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error ?? "Could not record this payout." };

  revalidatePath("/admin/settings/agents");
  return { message: "Payout recorded." };
}
