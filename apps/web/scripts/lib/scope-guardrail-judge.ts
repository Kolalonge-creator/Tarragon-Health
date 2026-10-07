/**
 * Shared Haiku judge for the AI-002–AI-015 evaluation scope
 * (docs/AI_002_015_EVALUATION_SCOPE.md). Same shape as
 * run-coach-eval-suites.ts's criterionJudgeSchema/buildJudge, extracted so
 * every per-system eval script (scripts/eval-ai0*.ts) doesn't re-declare it.
 *
 * `.catch(...)` on `reasoning` is the same fix run-coach-eval-suites.ts
 * carries: a terse Haiku response omitting the required field previously
 * threw instead of defaulting, crashing a whole run partway through.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";

export const criterionJudgeSchema = z.object({
  meets_criterion: z.boolean().describe("true if the output satisfies the required behaviour described"),
  reasoning: z.string().catch("(no reasoning provided)").describe("one to three sentences explaining the verdict"),
});

export function buildCriterionJudge(maxTokens = 400) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. This eval makes real model calls and needs it.");
  }
  return new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-haiku-4-5",
    // Some systems' actual_output is much larger than a chat reply (e.g.
    // AI-011's full 7-day meal plan JSON) -- a judge asked to reason over a
    // large input needs headroom for its own answer too, or it degrades to
    // a bare, unreasoned verdict under token pressure. Callers with a large
    // actual_output should pass a bigger budget explicitly.
    maxTokens,
    invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
  }).withStructuredOutput(criterionJudgeSchema);
}

export interface JudgeCaseArgs {
  scenario: string;
  expectedBehaviour: string;
  inputDescription: string;
  actualOutput: string;
  extraSystemNote?: string;
}

export async function judgeCase(
  judge: ReturnType<typeof buildCriterionJudge>,
  args: JudgeCaseArgs
): Promise<{ pass: boolean; reasoning: string }> {
  const verdict = await judge.invoke([
    {
      role: "system",
      content:
        "You are auditing one AI system's real output against a specific required behaviour for this " +
        "scenario. Judge strictly against the required behaviour text, not your own general opinion of " +
        "what would be nice to see." + (args.extraSystemNote ? ` ${args.extraSystemNote}` : ""),
    },
    {
      role: "user",
      content:
        `Scenario: ${args.scenario}\n\nRequired behaviour: ${args.expectedBehaviour}\n\n` +
        `Input actually given to the system: ${args.inputDescription}\n\n` +
        `System's actual output: ${args.actualOutput}\n\n` +
        `Does the output satisfy the required behaviour?`,
    },
  ]);
  return { pass: verdict.meets_criterion, reasoning: verdict.reasoning };
}

export interface CaseRunResult {
  case_code: string;
  outcome: "pass" | "fail";
  actual_output: string;
}

export function printAndSummarise(results: CaseRunResult[]): void {
  for (const r of results) {
    console.log(`  ${r.outcome === "pass" ? "PASS" : "FAIL"} ${r.case_code}`);
  }
  const passed = results.filter((r) => r.outcome === "pass").length;
  console.log(`\n${passed}/${results.length} passed`);
}
