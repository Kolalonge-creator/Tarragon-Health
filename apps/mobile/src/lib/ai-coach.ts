import type { CoachChatMessage, CoachSuggestedAction } from "@tarragon/shared";
import { supabase } from "./supabase";
import { postCoachHandoffToCareTeam, postCoachMessage, postCoachQuickAction, type CoachQuickActionKind } from "./api";

export type { CoachChatMessage, CoachSuggestedAction };

/**
 * Native AI Coach -- mirrors apps/web/.../patient/ai-coach-chat.tsx's data
 * layer (lib/queries/ai-coach.ts). The turn itself (entitlement, rate
 * limiting, the governed Claude call, the audit write) only runs
 * server-side -- see apps/web/src/app/api/mobile/ai-coach/*.ts -- but the
 * conversation thread lives in ai_conversations, which RLS already lets a
 * patient read directly, so loading history is a plain client read, exactly
 * like every other native screen on this app.
 */

/** §78.2 -- where each suggestedAction the model can classify points on
 * mobile. Mirrors ai-coach-chat.tsx's SUGGESTION_LINK, but at native
 * SectionIds rather than web paths, since the model only ever picks a kind
 * (prompts.ts), never a URL or record id. service_navigation has no native
 * home yet, so it falls back to Care & support, the same screen its web
 * equivalent (/patient/care#find-a-service) lives on. */
export const COACH_SUGGESTION_SECTION: Record<Exclude<CoachSuggestedAction, "none">, { section: string; label: string }> = {
  medication_education: { section: "medications", label: "Look at your medications" },
  care_plan_explanation: { section: "care", label: "See your care plan" },
  appointment_prep: { section: "appointments", label: "See your appointments" },
  service_navigation: { section: "care", label: "Find a service" },
};

/** Same wording as apps/web's ai-coach-chat.tsx footer disclaimer -- kept as
 * a literal here rather than a cross-package import, since apps/mobile
 * can't import from apps/web. */
export const COACH_DISCLAIMER =
  "General guidance, not a diagnosis. For an emergency, call emergency services or go to the nearest hospital.";

export interface AiConversation {
  conversationId: string | undefined;
  messages: CoachChatMessage[];
}

/** Mirrors useAiConversation's query exactly (same table, same "most
 * recently updated thread" ordering) -- see lib/queries/ai-coach.ts. */
export async function loadAiConversation(patientId: string): Promise<AiConversation> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, messages")
    .eq("profile_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    conversationId: data?.id,
    messages: (data?.messages as CoachChatMessage[] | null) ?? [],
  };
}

/** Same private.has_ai_coach_access() RPC the web card's server-rendered
 * gate calls -- lets the app hide the entry point for a patient with no
 * access, while runCoachTurn's own server-side check (defense in depth)
 * still applies regardless. */
export async function hasCoachAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_ai_coach_access");
  if (error) return false;
  return data ?? false;
}

export async function sendCoachMessage(message: string, conversationId?: string) {
  return postCoachMessage(message, conversationId);
}

export async function runCoachQuickAction(kind: CoachQuickActionKind, conversationId?: string) {
  return postCoachQuickAction(kind, conversationId);
}

export async function requestCareTeamHandoff(conversationId?: string) {
  return postCoachHandoffToCareTeam(conversationId);
}
