"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getActiveProtocol } from "./protocol";
import { resolveTriageDisposition } from "./engine";
import { safetyNetCopyFor } from "./copy";
import { persistTriageAssessment } from "./escalate";
import { detectEmergencyKeywords } from "@/lib/ai-coach/keyword-guardrail";
import type { InitialCapture, OutcomeNode, RedFlagScreenEntry, TriagePathway } from "./types";

export type GetPathwaysResult =
  | { status: "available"; pathways: TriagePathway[] }
  | { status: "not_available" };

/**
 * The full active protocol's pathways -- or "not_available" when no
 * protocol has been signed off yet (triage_protocols has a draft, unsigned
 * v1 as of this writing; see protocol.ts). Returning the whole node graph
 * (not a stripped summary) is deliberate: triage_protocols' own RLS policy
 * is a bare `true` SELECT (public data), and the client needs the full
 * graph to walk it step-by-step via engine.ts's pure functions without a
 * round-trip per question -- submitSymptomTriageAssessmentAction()
 * re-resolves the disposition from scratch server-side regardless, so
 * nothing here is trusted for the actual outcome.
 */
export async function getSymptomTriagePathwaysAction(): Promise<GetPathwaysResult> {
  const supabase = await createClient();
  const protocol = await getActiveProtocol(supabase);
  if (!protocol) return { status: "not_available" };
  return { status: "available", pathways: protocol.config.pathways };
}

const captureSchema = z.object({
  severity: z.number().min(0).max(10),
  onset: z.enum(["sudden", "gradual"]),
  associatedSymptoms: z.array(z.string()).max(20),
  history: z.array(z.string()).max(20),
  triggers: z.array(z.string()).max(20),
  measurements: z.record(z.string(), z.number()),
  /** Optional free-text "anything else" -- never feeds the disposition
   * logic directly, only checked as an emergency-upgrade-only backstop
   * (same always-wins discipline as ai-coach's keyword guardrail). */
  note: z.string().trim().max(500).optional(),
});

const submitSchema = z.object({
  pathwayKey: z.string().min(1).max(100),
  capture: captureSchema,
  answers: z.record(z.string(), z.union([z.boolean(), z.string()])),
});

export type SubmitTriageResult =
  | { status: "ok"; category: string; message: string; clinicianNotified: boolean }
  | { status: "incomplete" }
  | { status: "not_available" }
  | { status: "error"; error: string };

/**
 * Re-resolves the disposition SERVER-SIDE from the raw capture/answers --
 * never trusts a client-computed category, same "the app computed this on
 * the patient's behalf" principle as every escalation path in this
 * codebase. Always re-fetches the active protocol fresh rather than
 * trusting a client-cached copy, so a protocol change between page-load and
 * submit can't be bypassed.
 */
export async function submitSymptomTriageAssessmentAction(
  input: unknown
): Promise<SubmitTriageResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) return { status: "error", error: "No organisation on file" };

  const protocol = await getActiveProtocol(supabase);
  if (!protocol) return { status: "not_available" };

  const pathway: TriagePathway | undefined = protocol.config.pathways.find(
    (p) => p.key === parsed.data.pathwayKey
  );
  if (!pathway) return { status: "error", error: "Unknown symptom category" };

  const capture: InitialCapture = parsed.data.capture;

  let redFlag: RedFlagScreenEntry | null;
  let outcome: OutcomeNode;
  try {
    ({ redFlag, outcome } = resolveTriageDisposition(pathway, capture, parsed.data.answers));
  } catch {
    return { status: "incomplete" };
  }

  // Free-text upgrade-only backstop: can only push toward emergency, never
  // away from whatever the structured rules already decided.
  if (capture.note && outcome.category !== "emergency" && detectEmergencyKeywords(capture.note)) {
    outcome = {
      type: "outcome",
      key: "note_keyword_backstop",
      category: "emergency",
      rationale: "Free-text note mentioned an emergency keyword despite the structured answers not flagging one.",
      safetyNetMessageKey: "generic.red_flag",
      clinicianReviewRequired: true,
    };
  }

  const svc = createServiceRoleClient();
  try {
    await persistTriageAssessment(svc, {
      organisationId: profile.organisation_id,
      patientId: user.id,
      loggedByProfileId: user.id,
      presentingComplaintKey: pathway.key,
      protocolVersion: protocol.version,
      capture,
      answers: parsed.data.answers,
      redFlag,
      outcome,
    });
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Could not save this assessment" };
  }

  return {
    status: "ok",
    category: outcome.category,
    message: safetyNetCopyFor(outcome.safetyNetMessageKey, outcome.category),
    clinicianNotified: outcome.clinicianReviewRequired,
  };
}
