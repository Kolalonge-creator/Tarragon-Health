import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { findRelevantFacilities, type FacilityMatch } from "./search";

const MODEL_ID = "claude-haiku-4-5";

const FACILITY_TYPES = ["hospital", "lab", "pharmacy", "radiology", "optician", "vaccination_centre"] as const;

const intentSchema = z.object({
  serviceType: z.enum(FACILITY_TYPES).nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
});

const INTENT_SYSTEM_PROMPT = `Extract search filters from a patient's question about where to get a health service in
Nigeria on a digital health platform. Return only what's explicitly said or clearly implied --
never guess a state or city that wasn't mentioned. serviceType must be one of: hospital, lab,
pharmacy, radiology, optician, vaccination_centre, or null if the question doesn't specify one of
these.`;

const answerSchema = z.object({ answer: z.string() });

const ANSWER_SYSTEM_PROMPT = `You are helping a patient find a service in Tarragon Health's facility directory on a Nigerian
digital health platform. You are given the patient's question and a list of real facilities that
matched their search -- never any other facility.

Rules, no exceptions:
- Only mention facilities from the list you were given, using their exact name and address as
  given. Never invent a facility, address, phone number, or price.
- If the list is empty, say so plainly and suggest broadening the search (a different area, or no
  service-type filter) -- never invent a result to avoid an empty answer.
- Keep it short: 2-4 plain, warm sentences.
- This is a directory lookup, not medical advice -- never suggest which facility is clinically
  better, only describe what's available.`;

function buildChatModel(model: ChatAnthropic | undefined, maxTokens: number): ChatAnthropic {
  return (
    model ??
    new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: MODEL_ID,
      maxTokens,
      // Same claude-*-5-generation workaround as ai-coach/model.ts.
      invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
    })
  );
}

export type ServiceNavigationResult =
  | { status: "answered"; answer: string; facilities: FacilityMatch[] }
  | { status: "failed" };

/**
 * Never throws to the caller -- degrades to { status: "failed" } on any
 * Claude or DB error, same fail-open discipline as every other generator in
 * this codebase. Two Claude calls: one to extract search filters from free
 * text (no patient data involved), one to phrase an answer strictly over
 * the real rows that search returned.
 */
export async function answerServiceNavigationQuestion(
  supabase: SupabaseClient<Database>,
  question: string,
  model?: ChatAnthropic
): Promise<ServiceNavigationResult> {
  try {
    const intentModel = buildChatModel(model, 200).withStructuredOutput(intentSchema);
    const intent = await intentModel.invoke([
      new SystemMessage(INTENT_SYSTEM_PROMPT),
      new HumanMessage(question),
    ]);

    const facilities = await findRelevantFacilities(supabase, {
      type: intent.serviceType,
      state: intent.state,
      city: intent.city,
    });

    const facilityLines =
      facilities.length > 0
        ? facilities
            .map(
              (f) =>
                `- ${f.name} (${f.type}), ${[f.address, f.area, f.city, f.state].filter(Boolean).join(", ")}${
                  f.hours ? `, hours: ${f.hours}` : ""
                }${f.contact_phone ? `, phone: ${f.contact_phone}` : ""}`
            )
            .join("\n")
        : "(no matching facilities found)";

    const answerModel = buildChatModel(model, 300).withStructuredOutput(answerSchema);
    const result = await answerModel.invoke([
      new SystemMessage(ANSWER_SYSTEM_PROMPT),
      new HumanMessage(`Patient's question: ${question}\n\nMatching facilities:\n${facilityLines}`),
    ]);

    return { status: "answered", answer: result.answer, facilities };
  } catch (error) {
    console.error("service-navigation: answerServiceNavigationQuestion failed", error);
    return { status: "failed" };
  }
}
