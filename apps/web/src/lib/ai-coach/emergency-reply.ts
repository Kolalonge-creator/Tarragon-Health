import type { SupabaseClient } from "@supabase/supabase-js";
import { SELF_HARM_REPLY, type Database } from "@tarragon/shared";
import { isSelfHarmMessage } from "./keyword-guardrail";
import { emergencyAddendumFor } from "./nearest-hospital";
import { pageOnCallForSelfHarm } from "./emergency-page";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";

/**
 * The one place an automatic emergency reply is built (S52, INV-05 and INV-06). Used by the live path, the assistant-closed path and the
 * kill-switch fallback so they cannot drift. Self-harm wording gets its own copy and the on-call page; the nearest hospitals are read at the
 * same time as the page (never one after the other) and are bounded, so a slow lookup cannot hold anything up for long.
 * Every path pages for self-harm; the graph node runs the escalation at the same time, never behind this.
 */
export async function buildEmergencyReply(
  deps: { supabase: SupabaseClient<Database>; service: SupabaseClient<Database> },
  params: { profileId: string; conversationId: string; message: string; fixedReply?: string },
): Promise<{ reply: string; selfHarm: boolean }> {
  const selfHarm = isSelfHarmMessage(params.message);
  const [paged, addendum] = await Promise.all([
    // the pager queues a durable row, waits a bounded time and keeps itself alive past the response (see emergency-page.ts)
    selfHarm ? pageOnCallForSelfHarm(deps.service, params.profileId, params.conversationId) : Promise.resolve(false),
    emergencyAddendumFor(deps.supabase, params.profileId),
  ]);
  const base = selfHarm ? SELF_HARM_REPLY : (params.fixedReply ?? EMERGENCY_SAFETY_REPLY);
  // Only say someone has been told when the page really went out (INV-05: never promise what did not happen)
  const told = paged ? "Someone on your care team has been told, and will try to reach you." : "";
  return { reply: [base, told, addendum].filter(Boolean).join("\n\n"), selfHarm };
}
