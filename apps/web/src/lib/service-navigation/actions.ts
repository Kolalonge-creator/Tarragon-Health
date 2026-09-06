"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";
import { answerServiceNavigationQuestion, type ServiceNavigationResult } from "./generate";
import type { FacilityMatch } from "./search";

const questionSchema = z.string().trim().min(1, "Ask a question first").max(300, "Keep it under 300 characters");

const DAILY_QUERY_LIMIT = 20;

export type AskServiceNavigationResult =
  | { status: "answered"; answer: string; facilities: FacilityMatch[] }
  | { status: "failed"; error: string };

/**
 * "Where can I do my blood test?" -- a friendlier, AI-phrased front end on
 * top of the same public facility directory facility-selector.tsx already
 * shows in full (queries/facilities.ts). Ungated, matching that directory's
 * own "curated, admin-maintained, no organisation_id scoping" openness --
 * this only makes it easier to ask, it doesn't reveal anything not already
 * visible. A modest per-day cap (reusing the ai-coach Lagos-day boundary
 * pattern, counted from this feature's own audit_log rows rather than a new
 * table) guards against runaway Claude spend from one account, not against
 * a patient who's genuinely trying to find care.
 */
export async function askServiceNavigationAction(question: string): Promise<AskServiceNavigationResult> {
  const parsed = questionSchema.safeParse(question);
  if (!parsed.success) return { status: "failed", error: parsed.error.issues[0]?.message ?? "Invalid question" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "failed", error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) return { status: "failed", error: "No organisation on file" };

  const svc = createServiceRoleClient();
  const startOfDayIso = startOfLagosDayUtc(new Date()).toISOString();
  const { count } = await svc
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", user.id)
    .eq("action", "service_navigation.query")
    .gte("created_at", startOfDayIso);
  if ((count ?? 0) >= DAILY_QUERY_LIMIT) {
    return { status: "failed", error: "You've reached today's search limit — it resets tomorrow." };
  }

  const result: ServiceNavigationResult = await answerServiceNavigationQuestion(supabase, parsed.data);

  await svc.from("audit_log").insert({
    organisation_id: profile.organisation_id,
    actor_id: user.id,
    action: "service_navigation.query",
    entity_type: "facilities",
    entity_id: null,
    event: {
      question: parsed.data,
      resultCount: result.status === "answered" ? result.facilities.length : 0,
    },
    result: result.status === "answered" ? "success" : "failed",
  });

  if (result.status === "failed") {
    return { status: "failed", error: "Couldn't put together an answer right now — try again shortly." };
  }
  return { status: "answered", answer: result.answer, facilities: result.facilities };
}
