import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { ComposedReport } from "@tarragon/clinical";
import { runGovernedAi, governedSystemPrompt } from "@/lib/ai-governance";
import { AI_SYSTEMS } from "@/lib/ai-governance/system-codes";
import { isSensitiveResultCode } from "@/lib/lab-results/guidance";

/**
 * AI-019: drafts the "your year in one paragraph" text for a clinician to edit and sign (S46, 3.15).
 *
 * Rules it lives by:
 *  - registered in ai_systems (AI-019, disabled until the CMO approves it) and called ONLY through runGovernedAi, so the kill switch and audit trail are real;
 *  - the draft is saved by the report builder ONLY on the unsigned draft row (INV-11); the patient never sees it and the database wipes it on signature;
 *  - it is given the composed report's states and numbers only: never a sensitive result (INV-04), never a free-text note, never a name;
 *  - it states no diagnosis, never says "optimal", never gives a biological age, never compares the person with others;
 *  - the fallback is the deterministic template paragraph, so a switched-off or failed model costs nothing.
 */

const MODEL_ID = "claude-haiku-4-5";
const outputSchema = z.object({ summary: z.string().min(1).max(900) });

const SYSTEM_PROMPT = `You draft ONE short paragraph (3 to 5 plain sentences, reading level about grade 6) summarising a person's yearly health report for a
clinician to edit and sign. You are given only structured facts: item states (on target, needs attention, not checked, not measured), values, counts and
the priorities already chosen. Rules, no exceptions:
- Use only the facts given. Never add a number, trend or condition that is not in them.
- Never diagnose, never name a disease, never suggest a medicine or dose.
- Never say "optimal", never give a biological age or healthspan, never compare the person with other people.
- Say plainly what was not measured. Do not say "on target" for anything that is not listed as on target.
- Never use the em dash character. Say "your care team", never "your doctor".
- Write in English.`;

function snapshot(c: ComposedReport): string {
  const lines = c.items
    .filter((i) => !isSensitiveResultCode(i.code))
    .map((i) => `${i.code}: ${i.state}${i.value !== null ? `, value ${i.value}${i.value2 !== null ? `/${i.value2}` : ""}` : ""}, readings ${i.readingCount}${i.tooFewReadings ? ", too few readings" : ""}${i.borderline ? ", borderline" : ""}, change ${i.change}`);
  const pri = c.priorities.map((p, n) => `${n + 1}. ${p.id}`);
  return `Year ${c.year}\nItems:\n${lines.join("\n") || "none"}\nPriorities:\n${pri.join("\n") || "none"}`;
}

export function createAiSummaryDrafter(supabase: SupabaseClient<Database>, model?: ChatAnthropic) {
  return async (composed: ComposedReport, patientId: string): Promise<string | null> => {
    const governed = await runGovernedAi<string | null>({
      supabase,
      systemCode: AI_SYSTEMS.healthReportSummaryDraft.code,
      inputCategory: "health_report_summary_draft",
      subjectProfileId: patientId,
      run: async ({ config }) => {
        const chat =
          model ??
          new ChatAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: MODEL_ID,
            maxTokens: 400,
            invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
          });
        const out = await chat
          .withStructuredOutput(outputSchema)
          .invoke([new SystemMessage(governedSystemPrompt(config) ?? SYSTEM_PROMPT), new HumanMessage(snapshot(composed))]);
        const text = out.summary.replace(/—/g, ",");
        return { value: text, modelIdentifier: MODEL_ID, outputSummary: "draft summary for clinician review", resultingAction: "draft_saved_on_unsigned_report" };
      },
      fallback: () => null,
    });
    return governed.value;
  };
}
