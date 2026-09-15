import { tool, type StructuredToolInterface } from "@langchain/core/tools";
// zod3, not zod — see tools.ts's own comment on why @langchain/core's tool()
// needs this exact package identity.
import { z } from "zod3";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import { requestSpecialistReferral } from "./referral-request";

/**
 * THE ONE WRITE-CAPABLE TOOL the AI Coach has, and deliberately kept out of
 * tools.ts to preserve that file's own "no tool defined here may write to
 * any table, ever" invariant as literally true. Built on an explicit
 * founder ask (2026-08-29) — see referral-request.ts's own header for what
 * this does and does not do: it never creates a binding specialist_referrals
 * row itself, only a clinician_alerts request a human clinician reviews.
 *
 * Bound into graph.ts's llmTurn alongside the read-only tools. The prompt
 * (prompts.ts) instructs the model to call this ONLY on a clear, explicit
 * patient request to see a specialist — never speculatively.
 */

const SPECIALIST_TYPES = [
  "urologist",
  "oncologist",
  "ob_gyn",
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "dietetics",
  "podiatry",
  "other",
] as const satisfies readonly Enums<"specialist_type">[];

const requestReferralSchema = z.object({
  specialistType: z
    .enum(SPECIALIST_TYPES)
    .describe("The kind of specialist the patient wants to see. Use 'other' if none of the listed types fit."),
  reason: z
    .string()
    .min(1)
    .describe("A short summary, in the patient's own words as best you can capture them, of why they want this referral."),
});

export interface ReferralToolDeps {
  patientSupabase: SupabaseClient<Database>;
  /** A function, not an already-constructed client — called only inside the
   * tool's own execution, when the model actually invokes it. Constructing
   * eagerly (e.g. while just building the tools array for bindTools, most
   * of which never get called in a given turn) would throw in any
   * environment missing SUPABASE_SERVICE_ROLE_KEY and break every chat
   * turn, not just referral requests — see CoachGraphDeps.getServiceRoleSupabase's
   * own "Lazy" doc comment in graph.ts, which this must honour the same way
   * escalate()/logReview() already do. */
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  organisationId: string;
  patientId: string;
  conversationId: string;
  /** Captures the created ids for the caller (graph.ts) to thread into the
   * ai_assistant_turns audit row — the tool's own return value is a JSON
   * string handed back to the model, not a structured channel back to the
   * graph, so this side-channel callback is how llmTurn learns what
   * actually got created, same shape as toolsCalled tracking. */
  onReferralRequested: (result: { clinicianAlertId: string; careMessageThreadId: string | null }) => void;
}

export function buildReferralRequestTool(deps: ReferralToolDeps): StructuredToolInterface {
  return tool(
    async (args: z.infer<typeof requestReferralSchema>) => {
      try {
        const result = await requestSpecialistReferral(deps.patientSupabase, deps.getServiceRoleSupabase(), {
          organisationId: deps.organisationId,
          patientId: deps.patientId,
          conversationId: deps.conversationId,
          specialistType: args.specialistType,
          reason: args.reason,
        });
        deps.onReferralRequested(result);
        return JSON.stringify({
          requested: true,
          note: "Flagged for the patient's care team to review. This is a request, not a booked appointment.",
        });
      } catch (error) {
        console.error("ai-coach: requestSpecialistReferral tool failed", error);
        return JSON.stringify({
          requested: false,
          note: "Could not create the referral request right now — tell the patient to contact their care team directly instead.",
        });
      }
    },
    {
      name: "requestSpecialistReferral",
      description:
        "Flag the patient's explicit request to see a specialist for their care team to review. This does " +
        "NOT create a booked appointment or a binding referral — it opens a request a clinician will review " +
        "and act on. Only call this when the patient has clearly and explicitly asked to see or be connected " +
        "with a specialist, never speculatively because a condition or symptom came up in conversation.",
      schema: requestReferralSchema,
    }
  );
}
