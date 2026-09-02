import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { buildCaseSnapshot, formatSnapshotForPrompt, type CaseSnapshot } from "./snapshot";
import { resolveProtocolsForPatient, primaryProtocol } from "@/lib/case-cockpit/protocol";
import { AI_SYSTEMS, governedSystemPrompt, runGovernedAi } from "@/lib/ai-governance";

const briefSchema = z.object({
  summary: z.string(),
  suggestedAction: z.string(),
  /**
   * A first-person review note the doctor reads, edits, and confirms --
   * the single biggest time sink in a case after reading it.
   *
   * IT IS PROSE, NOT AN ACTION. It reaches the doctor as editable text in a
   * textarea, clearly labelled as AI-drafted, and nothing happens until they
   * submit it -- at which point it is recorded through case_review_actions
   * like any other confirmed action, with their name on it. The one-click
   * actions themselves come from the deterministic rule engine
   * (lib/case-cockpit/propose.ts) and never from here; case_review_actions
   * carries a CHECK that makes that structural rather than conventional.
   */
  draftReviewNote: z.string(),
});

const MODEL_ID = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are drafting a brief for a clinician or doctor about to review a patient
alert on a clinical platform. You are given a structured, minimized data snapshot -- not the
patient's full chart or clinical notes.

Rules, no exceptions:
- Ground every sentence in the data you were given. Never state a fact, trend, or number that isn't
  in the snapshot.
- Never diagnose. Never suggest a specific medication, dose, or treatment.
- The "suggested action" is a next step for the reader's OWN review (e.g. "confirm the reading with
  the patient", "check whether this matches their care plan's target range"), never a clinical
  decision made on their behalf.
- Write the summary in 3-5 plain sentences. If the data is thin, say so plainly rather than padding.
- This is a draft for the reader to review before they assess the case themselves -- it is never
  shown to the patient and never treated as the reader's own clinical assessment.

For the "draftReviewNote" field specifically:
- Write it as the note the reviewing doctor would put on the record, in the first person, past
  tense ("Reviewed the reading of..."), 2-4 sentences.
- LEAVE THE JUDGMENT BLANK. State what was reviewed and what the data shows; do not state a
  conclusion, a plan, or an outcome. Where the doctor's assessment belongs, write a bracketed
  placeholder such as "[assessment]" or "[plan]" for them to complete. A note that arrives with
  the conclusion already written invites confirming it unread, which is the exact failure this
  whole feature must not cause.
- Refer to the signed protocol ONLY if the snapshot names one in force. If it says there is no
  signed protocol, do not mention protocols at all -- do not substitute general guidance.`;

type GenerateParams = { clinicianAlertId: string; organisationId: string; patientId: string };

/** Named so runGovernedAi can be parameterised on it. */
export interface GenerateResult {
  status: "generated" | "failed";
  summary?: string;
  suggestedAction?: string;
  draftReviewNote?: string;
}

/**
 * Never throws. On any failure (missing/invalid API key, network error,
 * refused response, malformed structured output) this returns a 'failed'
 * result rather than propagating -- the caller (the claim/acknowledge-time
 * trigger, or a manual "Generate" button) must be able to proceed with no
 * brief rather than break the page. Same fail-open discipline as
 * packages/shared/ml-client.ts and the AI Coach's llmTurn.
 *
 * Keyed by clinician_alert_id, not escalation_id -- one brief serves both
 * the clinician worklist (generated on acknowledge, no escalation exists
 * yet) and the doctor escalation worklist (same alert, now escalated).
 * Pass escalationReason when calling from the doctor side so the model
 * sees why a doctor was actually pulled in, not just the alert itself.
 */
export async function generateCaseBrief(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  escalationReason: string | null = null,
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<GenerateResult> {
  const { clinicianAlertId, organisationId, patientId } = params;

  let snapshot: CaseSnapshot | null = null;
  try {
    snapshot = await buildCaseSnapshot(supabase, clinicianAlertId, escalationReason);
  } catch (error) {
    console.error("case-briefs: buildCaseSnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(getServiceRoleSupabase(), params, null, "Could not load case data");
    return { status: "failed" };
  }

  // Ground the draft in the SIGNED protocol, never the unsigned WHO reference
  // content. primaryProtocol prefers a signed protocol when the patient has
  // several conditions; if the chosen one is unsigned we deliberately pass
  // nothing, so the prompt's explicit "there is no signed protocol" branch
  // fires and the model is told not to reference protocol guidance. Failing
  // to resolve a protocol is never fatal -- the brief is still worth having.
  const protocol = primaryProtocol(
    await resolveProtocolsForPatient(supabase, patientId, organisationId)
  );
  const signedProtocol = protocol?.signedVersion ?? null;

  snapshot.signedProtocol =
    protocol && signedProtocol
      ? {
          condition: protocol.condition,
          versionNumber: signedProtocol.versionNumber,
          title: signedProtocol.title,
          targets: protocol.monitoring.targets,
          redFlags: protocol.escalation.redFlags,
          cadence: protocol.monitoring.cadence,
        }
      : null;

  const promptText = formatSnapshotForPrompt(snapshot);

  // AI-004 in the registry. runGovernedAi checks the kill switch before the
  // model is reached, records the interaction either way (40.11), and routes
  // a switched-off or failed call to the same persistFailure path this
  // function already used for a failed one -- so "the brief did not
  // generate" behaves identically whether the cause was a bad API key or a
  // deliberate governance decision, which is exactly what 40.18 asks for.
  const governed = await runGovernedAi<GenerateResult>({
    supabase,
    systemCode: AI_SYSTEMS.caseBrief.code,
    inputCategory: "clinician_alert_case_brief",
    subjectProfileId: patientId,

    run: async ({ config }) => {
      // Built inside the run callback, not passed as a bare default param --
      // a missing/invalid ANTHROPIC_API_KEY must degrade this call, not throw
      // before we can catch it. Same shape as ai-coach/graph.ts's llmTurn.
      const chatModel =
        model ??
        new ChatAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: MODEL_ID,
          maxTokens: 400,
          // Same claude-*-5-generation workaround as lib/ai-coach/graph.ts's
          // buildModel() -- @langchain/anthropic@0.3.x unconditionally sends
          // temperature/top_p/top_k, which this model generation rejects
          // outright.
          invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
        });
      const structuredModel = chatModel.withStructuredOutput(briefSchema);

      const result = await structuredModel.invoke([
        new SystemMessage(governedSystemPrompt(config) ?? SYSTEM_PROMPT),
        new HumanMessage(promptText),
      ]);

      const svc = getServiceRoleSupabase();
      await svc.from("case_briefs").upsert(
        {
          organisation_id: organisationId,
          clinician_alert_id: clinicianAlertId,
          patient_id: patientId,
          status: "generated",
          model_id: MODEL_ID,
          summary_text: result.summary,
          suggested_action_text: result.suggestedAction,
          draft_review_note: result.draftReviewNote,
          // Null whenever the protocol was unsigned or absent -- the UI reads
          // this column, not a boolean, so "drafted against protocol v3" can
          // never render without a real signed row behind it.
          protocol_version_id: signedProtocol?.id ?? null,
          protocol_slug: signedProtocol && protocol ? protocol.protocolSlug : null,
          input_snapshot: snapshot as unknown as Json,
          error_message: null,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "clinician_alert_id" }
      );

      return {
        value: {
          status: "generated",
          summary: result.summary,
          suggestedAction: result.suggestedAction,
          draftReviewNote: result.draftReviewNote,
        },
        modelIdentifier: MODEL_ID,
        outputSummary: result.summary,
        resultingAction: "case_brief_drafted",
        resultingEntityType: "clinician_alerts",
        resultingEntityId: clinicianAlertId,
      };
    },

    fallback: async (reason, error) => {
      const detail =
        reason === "ai_error"
          ? error instanceof Error
            ? error.message
            : "Unknown error"
          : `No brief drafted: ${reason}.`;
      if (reason === "ai_error") {
        console.error("case-briefs: generation failed, degrading to no brief", error);
      }
      await persistFailure(getServiceRoleSupabase(), params, snapshot, detail);
      return { status: "failed" };
    },
  });

  return governed.value;
}

async function persistFailure(
  svc: SupabaseClient<Database>,
  params: GenerateParams,
  snapshot: CaseSnapshot | null,
  errorMessage: string
): Promise<void> {
  try {
    await svc.from("case_briefs").upsert(
      {
        organisation_id: params.organisationId,
        clinician_alert_id: params.clinicianAlertId,
        patient_id: params.patientId,
        status: "failed",
        model_id: MODEL_ID,
        input_snapshot: (snapshot ?? {}) as unknown as Json,
        error_message: errorMessage,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "clinician_alert_id" }
    );
  } catch (error) {
    // Even the failure record failed to write -- log and give up rather than
    // let a persistence problem here take down the caller.
    console.error("case-briefs: could not persist failure record", error);
  }
}
