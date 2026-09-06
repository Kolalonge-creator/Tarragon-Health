"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runQuickAction, type QuickActionKind } from "@/lib/ai-coach/quick-actions";
import { quickActionSchema, type QuickActionInput } from "@/lib/validation/ai-coach";

export type RunQuickActionResult =
  | { success: true; conversationId: string; reply: string }
  | { success: false; error: string };

/**
 * §36.5/§36.8/§36.9 quick actions ("Explain my health record", "What do I
 * need to do this month", "Help me prepare for my appointment") — the
 * server-action counterpart to sendCoachMessage (ai-coach-actions.ts), for
 * lib/ai-coach/quick-actions.ts's deterministic, non-Claude surfaces.
 */
export async function runAiCoachQuickAction(input: QuickActionInput): Promise<RunQuickActionResult> {
  const parsed = quickActionSchema.safeParse(input);
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
    const result = await runQuickAction({
      supabase,
      getServiceRoleSupabase: createServiceRoleClient,
      profileId: user.id,
      organisationId: profile.organisation_id,
      conversationId: parsed.data.conversationId,
      kind: parsed.data.kind as QuickActionKind,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Something went wrong" };
  }
}
