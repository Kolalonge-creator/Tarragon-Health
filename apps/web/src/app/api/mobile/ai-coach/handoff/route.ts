import { z } from "zod";
import { NextResponse } from "next/server";
import type { CoachChatMessage } from "@tarragon/shared";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildCoachHandoffSummary } from "@/lib/ai-coach/handoff-summary";
import { loadHandoffSnapshot } from "@/lib/ai-coach/escalate";

const bodySchema = z.object({ conversationId: z.string().uuid().optional() });

/**
 * Mobile equivalent of apps/web/.../patient/ai-coach-actions.ts's sibling
 * handoff-actions.ts (requestCareTeamHandoffAction) -- §78.12 "I want to
 * speak to someone". Calls start_care_thread on the bearer-scoped session
 * (not service-role), same reasoning as the web version: this is the
 * patient's own message, and private.enforce_care_message_author() stamps
 * author_role from auth.uid().
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
  }

  let recentMessages: CoachChatMessage[] = [];
  if (parsed.data.conversationId) {
    const { data: conversation } = await supabase
      .from("ai_conversations")
      .select("messages")
      .eq("id", parsed.data.conversationId)
      .maybeSingle();
    recentMessages = ((conversation?.messages as CoachChatMessage[] | null) ?? []).slice(-10);
  }

  const svc = createServiceRoleClient();
  const snapshot = await loadHandoffSnapshot(svc, user.id);
  const summaryBody = await buildCoachHandoffSummary({
    recentMessages,
    triggerMessage:
      recentMessages.filter((m) => m.role === "user").at(-1)?.content ??
      "Patient asked to speak with someone directly, without a specific message.",
    aiAction: "Patient asked to speak with a person instead of continuing with the AI Coach",
    medications: snapshot.medications,
    conditions: snapshot.conditions,
  });

  const { data: threadId, error } = await supabase.rpc("start_care_thread", {
    p_subject: "From your AI Coach conversation",
    p_body: summaryBody,
  });
  if (error || !threadId) {
    return NextResponse.json(
      { error: error?.message ?? "Could not start a conversation with your care team" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, threadId });
}
