import { ChatAnthropic } from "@langchain/anthropic";

/** Shared Claude client builder for every LangGraph-based coaching surface
 * in this codebase (the general AI Coach in graph.ts, and the lifestyle
 * nudge proposer in lib/lifestyle/coaching-proposer.ts). Extracted so the
 * claude-sonnet-5 quirk below lives in one place instead of drifting across
 * copies. */
export function buildAnthropicModel(opts: { maxTokens?: number } = {}): ChatAnthropic {
  return new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
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
