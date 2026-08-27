"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { preventionCampaignFormSchema } from "@/lib/validation/prevention-campaign";
import type { Json } from "@tarragon/shared";

export type SaveCampaignState = { error?: string; success?: boolean } | undefined;
export type SetCampaignStatusState = { error?: string; success?: boolean } | undefined;

export async function createPreventionCampaignAction(
  _prev: SaveCampaignState,
  formData: FormData
): Promise<SaveCampaignState> {
  const parsed = preventionCampaignFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid values" };
  }

  const profile = await getCurrentProfile();
  if (profile?.role !== "admin" || !profile.organisation_id) {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("prevention_campaigns").insert({
    organisation_id: profile.organisation_id,
    code: parsed.data.code,
    name: parsed.data.name,
    description: parsed.data.description || null,
    starts_on: parsed.data.starts_on,
    ends_on: parsed.data.ends_on || null,
    eligibility_rule: JSON.parse(parsed.data.eligibility_rule_json) as Json,
    actions: JSON.parse(parsed.data.actions_json) as Json,
    status: "draft",
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/prevention-campaigns");
  return { success: true };
}

/** draft -> active -> ended is the only allowed direction; never reopens an ended campaign. */
export async function setCampaignStatusAction(
  campaignId: string,
  status: "active" | "ended"
): Promise<SetCampaignStatusState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("prevention_campaigns")
    .update({ status })
    .eq("id", campaignId)
    .neq("status", "ended");
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/prevention-campaigns");
  return { success: true };
}
