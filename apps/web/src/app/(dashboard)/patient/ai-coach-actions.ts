"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { coachMessageSchema, type CoachMessageInput } from "@/lib/validation/ai-coach";
import { runCoachTurn } from "@/lib/ai-coach";
import type { CoachTier } from "@tarragon/shared";

export type SendCoachMessageResult =
  | { success: true; conversationId: string; reply: string; tier: CoachTier }
  | { success: false; error: string };

export async function sendCoachMessage(input: CoachMessageInput): Promise<SendCoachMessageResult> {
  const parsed = coachMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not signed in" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { success: false, error: "No organisation on file" };
  }

  try {
    const result = await runCoachTurn({
      supabase,
      getServiceRoleSupabase: createServiceRoleClient,
      profileId: user.id,
      organisationId: profile.organisation_id,
      conversationId: parsed.data.conversationId,
      message: parsed.data.message,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Something went wrong" };
  }
}
