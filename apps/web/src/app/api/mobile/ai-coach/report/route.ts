import { z } from "zod";
import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";

/**
 * S52 (spec 7.9): "Report this answer" on the phone. The same database function the web button uses (report_ai_safety_incident): it files
 * the incident against AI-001, links the exact turn when the patient is allowed to see it, and flags it for the monthly review.
 * Deliberately not behind the assistant_enabled guard: a patient must always be able to say an answer was wrong.
 */
const CATEGORIES = [
  "incorrect_information",
  "inappropriate_recommendation",
  "missed_escalation",
  "fabricated_citation",
  "privacy_concern",
  "other",
] as const;

const bodySchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(5, "Tell us a little about what was wrong. Even one sentence helps.").max(4000),
  // required: a report is about ONE answer. Never guessed, never defaulted to the latest turn.
  interactionId: z.string().uuid({ message: "Open the answer you want to report and try again." }),
});

export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  // The answer being reported must be one of the caller's own (RLS-scoped read), so an id that is not theirs is refused rather than filed.
  const { data: own } = await supabase.from("ai_assistant_turns").select("id").eq("interaction_id", parsed.data.interactionId).eq("patient_id", user.id).limit(1).maybeSingle();
  if (!own) return NextResponse.json({ error: "We could not find that answer. Open the answer you want to report and try again." }, { status: 400 });
  const interactionId = parsed.data.interactionId;
  const { error } = await supabase.rpc("report_ai_safety_incident", {
    p_system_code: "AI-001",
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_interaction_id: interactionId,
  });
  if (error) return NextResponse.json({ error: "We could not file that just now. Please try again." }, { status: 500 });
  return NextResponse.json({ success: true });
}
