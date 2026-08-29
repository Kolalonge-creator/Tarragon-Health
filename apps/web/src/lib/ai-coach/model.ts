import { ChatAnthropic } from "@langchain/anthropic";

/** The model id every buildAnthropicModel() call actually resolves to --
 * exported so a caller can stamp it onto a persisted record (e.g. a
 * CoachChatMessage's `model` field) without duplicating the env-override
 * expression, and so it stays in sync if that expression ever changes. */
export const AI_COACH_MODEL_ID = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/** Shared Claude client builder for every LangGraph-based coaching surface
 * in this codebase (the general AI Coach in graph.ts, and the lifestyle
 * nudge proposer in lib/lifestyle/coaching-proposer.ts). Extracted so the
 * claude-sonnet-5 quirk below lives in one place instead of drifting across
 * copies. */
export function buildAnthropicModel(opts: { maxTokens?: number } = {}): ChatAnthropic {
  return new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: AI_COACH_MODEL_ID,
    maxTokens: opts.maxTokens ?? 500,
    // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
    // top_k on every request (defaulting top_p/top_k to a -1 "unset"
    // sentinel it only omits for a few hardcoded older model-name
    // substrings). The claude-sonnet-5 API rejects all three outright for
    // this model generation ("`top_p` cannot be set to -1", "`temperature`
    // is deprecated") — invocationKwargs is spread last in this package's
    // request-building code, so setting them to `undefined` here overrides
    // the class defaults and omits the keys from the request entirely.
    invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
  });
}
