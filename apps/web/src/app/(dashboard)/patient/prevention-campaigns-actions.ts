"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";

export type JoinCampaignState = { error?: string; success?: boolean } | undefined;

/** Patient opt-in — writes through their own RLS-scoped session, same trust level as vaccination_records. */
export async function joinPreventionCampaignAction(campaignId: string): Promise<JoinCampaignState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const subjectId = await resolveSubjectId(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("prevention_campaign_enrolments").insert({
    organisation_id: profile.organisation_id,
    campaign_id: campaignId,
    patient_id: subjectId,
    status: "joined",
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/prevention");
  return { success: true };
}
