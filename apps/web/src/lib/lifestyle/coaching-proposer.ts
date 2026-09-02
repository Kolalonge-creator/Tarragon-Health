import "server-only";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import {
  proposeNextAction,
  type CoachingAction,
  type CoachingProposer,
  type ProgrammeSignals,
} from "@tarragon/lifestyle-engine";
import { buildAnthropicModel } from "@/lib/ai-coach/model";
import { AI_SYSTEMS, governedSystemPrompt, runGovernedAi } from "@/lib/ai-governance";
import type { Embedder } from "./embed-content";
import { findRelevantLifestyleContent, type RelevantContentBlock } from "./find-relevant-content";

export interface LifestyleProposerContext {
  /** Raw enum value so retrieval (find-relevant-content.ts) can filter by it. */
  condition: Enums<"care_plan_condition">;
  conditionLabel: string;
  programmeName: string | null;
  currentPhaseName: string | null;
  goalTitles: string[];
  /** Most-recent-first, small slice — just enough for the model to notice a
   * trend without re-deriving what coaching-run.ts's ML/heuristic signals
   * already computed. */
  recentWeightKg: { value: number; takenAt: string }[];
}

const messageSchema = z.object({
  message: z.string().max(400),
});

// Mirrors packages/lifestyle-engine/src/messaging/index.ts's toneGuard deny
// list explicitly, so a rejected message (screened again at send time by
// messaging-gateway.ts) is the rare case, not the common one.
const PROPOSER_SYSTEM_PROMPT = `You are writing a short, warm, supportive WhatsApp
nudge for a Tarragon Health patient who has gone quiet on their lifestyle
programme. You will be given their condition, programme phase, current goals,
recent weight readings if any, and possibly some clinician-approved reference
material relevant to their programme — use whatever is genuinely useful to
make the nudge feel personal, not generic. If reference material is given, draw
on the idea in your own words and voice — never quote it at length or present
it as a document; it is background, not the message itself.

Rules:
- At most 2 short sentences.
- Person-first, encouraging tone — never shame, blame, or urgency.
- Never say "obese", "fat", "overweight", "failure", "failed", "cheat",
  "cheating", "lazy", "willpower", or "shame".
- Never state a clinical verdict — never say a reading "is fine/normal/
  controlled/good/okay" or "nothing to worry about" or "you're fine/healthy".
- Never mention a specific weight or BP/glucose number as praise or criticism.
- Do not diagnose, prescribe, or suggest a treatment change.
- If you have nothing personal to say, write a generic supportive check-in
  instead of inventing detail.`;

/** A CoachingProposer that only personalises the copy of a `send_nudge`
 * action — which action to take is decided exactly the same way it is today
 * (proposeNextAction, deterministic), so the guardrail-audited kind
 * selection in @tarragon/lifestyle-engine is unchanged. The LLM's only job
 * is writing the nudge text; applyGuardrails still runs on the result via
 * runCoachingLoop, same as any other proposer. */
/** The model call itself, shared by the governed and un-attributable paths.
 * Never throws: on any failure the bare deterministic action is returned, and
 * coaching-run.ts renders the generic template. */
async function proposeWithModel(
  base: CoachingAction,
  context: LifestyleProposerContext,
  referenceMaterial: RelevantContentBlock[],
  model: ChatAnthropic | undefined,
  governedPrompt: string | null
): Promise<CoachingAction> {
  try {
    const chat = model ?? buildAnthropicModel({ maxTokens: 200 });
    const structured = chat.withStructuredOutput(messageSchema);
    const result = await structured.invoke([
      new SystemMessage(governedPrompt ?? PROPOSER_SYSTEM_PROMPT),
      new HumanMessage(JSON.stringify({ context, referenceMaterial })),
    ]);
    return { ...base, message: result.message };
  } catch {
    return base;
  }
}

export function createLifestyleCoachingProposer(
  context: LifestyleProposerContext,
  opts: {
    model?: ChatAnthropic;
    /** Service-role client (coaching-run.ts runs with no patient session) —
     * only needed for reference-material retrieval; omit to skip it. */
    supabase?: SupabaseClient<Database>;
    /** `undefined`/`null` skips retrieval gracefully — same no-op contract
     * as the rest of the embedding pipeline. */
    embedder?: Embedder | null;
    /** The patient this nudge is for. Required for the AI-002 audit trail
     * (40.11); without it the interaction cannot be attributed and the
     * governance check is skipped rather than logged against nobody. */
    patientId?: string;
  } = {},
): CoachingProposer {
  return {
    async propose(signals: ProgrammeSignals): Promise<CoachingAction> {
      const base = proposeNextAction(signals);
      if (base.kind !== "send_nudge") return base;

      let referenceMaterial: RelevantContentBlock[] = [];
      if (opts.embedder && opts.supabase) {
        const queryText = [context.conditionLabel, context.currentPhaseName, ...context.goalTitles]
          .filter((part): part is string => Boolean(part))
          .join(", ");
        referenceMaterial = await findRelevantLifestyleContent(opts.supabase, opts.embedder, queryText, {
          matchCount: 1,
          conditionFilter: context.condition,
          subjectProfileId: opts.patientId,
        });
      }

      // AI-002. The fallback here is the deterministic action with no
      // `message`, which coaching-run.ts renders as the generic template --
      // i.e. the patient still gets a nudge, just not a personalised one.
      // That is the fallback_behaviour recorded for this system, and it is
      // the same path the pre-governance catch block already took.
      const supabase = opts.supabase;
      if (!supabase || !opts.patientId) {
        // No client or no subject means nothing to attribute an audit row to.
        // Kept working rather than blocked: AI-002 is moderate-risk and
        // fails open (see system-codes.ts), and this branch only occurs for
        // a caller that has not been given a service-role client at all.
        return await proposeWithModel(base, context, referenceMaterial, opts.model, null);
      }

      const governed = await runGovernedAi<CoachingAction>({
        supabase,
        systemCode: AI_SYSTEMS.lifestyleNudgeProposer.code,
        inputCategory: "lifestyle_nudge_draft",
        subjectProfileId: opts.patientId,
        run: async ({ config }) => {
          const action = await proposeWithModel(
            base,
            context,
            referenceMaterial,
            opts.model,
            governedSystemPrompt(config)
          );
          return {
            value: action,
            modelIdentifier: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
            outputSummary: action.kind === "send_nudge" ? (action.message ?? null) : null,
            resultingAction: "nudge_message_drafted",
          };
        },
        fallback: () => base,
      });

      return governed.value;
    },
  };
}
