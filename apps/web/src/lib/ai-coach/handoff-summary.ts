import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, Database } from "@tarragon/shared";
import { AI_SYSTEMS, decideAiGovernance } from "@/lib/ai-governance";

const MODEL_ID = "claude-haiku-4-5";

const summarySchema = z.object({
  concern: z.string(),
  symptoms: z.string(),
  medication: z.string(),
  relevantHistory: z.string(),
});

const SYSTEM_PROMPT = `You are preparing a handoff summary so a human on the patient's care team doesn't have to
re-read a whole chat transcript before helping. You are given the recent AI Coach conversation and
a minimised snapshot of the patient's active medications and care-plan conditions -- never their
full chart.

Fill in exactly these four fields, each 1 short sentence, using "Not mentioned" or "None on file"
when there's nothing to say rather than inventing something:
- concern: what the patient actually said they're worried about or asking about, in their own words
  as much as possible.
- symptoms: any physical/mental symptoms mentioned in the conversation, if any.
- medication: only medications from the snapshot that are actually relevant to this conversation --
  never invent a medication or suggest a dose.
- relevantHistory: only conditions from the snapshot actually relevant to this conversation.

Rules, no exceptions: never diagnose, never suggest a medication or treatment, never state
anything not present in the conversation or snapshot you were given.`;

export type HandoffSummaryInput = {
  recentMessages: CoachChatMessage[];
  triggerMessage: string;
  aiAction: string;
  medications: string[];
  conditions: string[];
  /**
   * Used only to read AI-001's kill switch before the model is called.
   *
   * REQUIRED, DELIBERATELY. This function used to take no client at all,
   * which is exactly why it was making a real ChatAnthropic call no kill
   * switch could reach: switching AI-001 off stopped the coach chat while
   * this kept calling the model. Making it optional would have reintroduced
   * the failure mode in a new place — a caller that forgot it would silently
   * get the template forever, with nothing anywhere looking wrong. Required
   * means forgetting it is a compile error instead.
   */
  supabase: SupabaseClient<Database>;
};

/**
 * §78.13 structured handoff summary -- "Patient concern / Symptoms /
 * Medication / Relevant history / AI action", replacing a raw quoted
 * message. Never throws: on any failure this falls back to a plain
 * templated version built with zero AI involvement (no fields left blank),
 * because a handoff summary failing to generate must never block the
 * escalation it's attached to.
 */
export async function buildCoachHandoffSummary(
  input: HandoffSummaryInput,
  model?: ChatAnthropic
): Promise<string> {
  const fallback = () => formatHandoffSummary(
    {
      concern: input.triggerMessage,
      symptoms: "Not extracted -- see concern above",
      medication: input.medications.length > 0 ? input.medications.join(", ") : "None on file",
      relevantHistory: input.conditions.length > 0 ? input.conditions.join(", ") : "None on file",
    },
    input.aiAction
  );

  // Nothing to summarise -- e.g. a patient who clicks "speak to someone"
  // without ever chatting with the coach first. Asking the model to
  // extract a concern/symptoms from an empty conversation produced
  // literal placeholder-looking text ("<UNKNOWN>") in practice rather than
  // reliably following the "say so plainly" instruction below -- skip the
  // call entirely rather than depend on prompt wording for this case.
  if (input.recentMessages.length === 0) {
    return fallback();
  }

  // 40.17. The handoff summary is part of AI-001, so AI-001 being switched
  // off has to stop it too — otherwise the kill switch stops the visible half
  // of the coach and leaves this half calling the model. The templated
  // fallback below needs no AI at all, so a switched-off system still
  // produces a complete, useful handoff and the escalation it is attached to
  // is never blocked.
  const governance = await decideAiGovernance(input.supabase, AI_SYSTEMS.coach.code);
  if (!governance.allow) return fallback();

  try {
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 300,
        // Same claude-*-5-generation workaround as every other generator in
        // this codebase -- see ai-coach/model.ts's comment for the full
        // explanation.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(summarySchema);

    const conversationText = input.recentMessages
      .map((m) => `${m.role === "user" ? "Patient" : "AI Coach"}: ${m.content}`)
      .join("\n");
    const snapshotText = [
      `Active medications: ${input.medications.length > 0 ? input.medications.join(", ") : "none on file"}`,
      `Active care-plan conditions: ${input.conditions.length > 0 ? input.conditions.join(", ") : "none on file"}`,
    ].join("\n");

    const result = await structuredModel.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Recent conversation:\n${conversationText}\n\n${snapshotText}`),
    ]);

    return formatHandoffSummary(result, input.aiAction);
  } catch (error) {
    console.error("ai-coach: buildCoachHandoffSummary failed, using template fallback", error);
    return fallback();
  }
}

export function formatHandoffSummary(
  fields: { concern: string; symptoms: string; medication: string; relevantHistory: string },
  aiAction: string
): string {
  return [
    `Patient concern: ${fields.concern}`,
    `Symptoms: ${fields.symptoms}`,
    `Medication: ${fields.medication}`,
    `Relevant history: ${fields.relevantHistory}`,
    `AI action: ${aiAction}`,
  ].join("\n");
}
