import {
  FACTS_DRAFT_SCHEMA,
  FACTS_DRAFT_SYSTEM_PROMPT,
  FACTS_SCHEMA,
  FACTS_SYSTEM_PROMPT,
  buildFactsDraftUserMessage,
  buildFactsUserMessage,
  type Citations,
  type ScribeFact,
  verifyFacts,
} from "./facts";

/**
 * The scribe's model call, as a plain function so the governance evaluation (ai-governance/run-scribe-eval-suites.ts)
 * exercises the same prompt, schema and model as the production edge function (supabase/functions/scribe-draft).
 * A Deno function cannot import from apps/web, so the three constants below are mirrored from the edge function and
 * scribe-draft-mirror.test.ts fails if they ever drift apart.
 */

export const SCRIBE_CLAUDE_MODEL = "claude-sonnet-5-5";
export const SCRIBE_CLAUDE_MAX_TOKENS = 4096;
/** Mirrors SCRIBE_PROMPT_VERSION in the edge function; bump both when the one-step prompt or schema changes. */
export const SCRIBE_PROMPT_VERSION = "scribe-v1";

export const SCRIBE_SYSTEM_PROMPT = `You are an AI clinical note assistant for TarragonHealth, a Nigerian digital health platform.
You will receive a transcript of a clinician-patient consultation, broken into speaker-tagged segments.
Your job is to produce TWO outputs:

1. A structured clinical note draft with these sections:
   - history: the patient's presenting complaint, history of presenting illness, and relevant background
   - examination: findings as reported in the conversation (do NOT invent examination findings not mentioned)
   - assessment: the clinician's working assessment based on what was discussed
   - plan: next steps discussed (investigations, referrals, follow-up)
   - followUp: safety-netting advice and when to return

2. A patient-facing summary in plain, warm language (in the same language variant as the consultation).
   This summary helps the patient remember what was discussed. It must NOT contain clinical jargon.

CRITICAL RULES:
- NEVER include medication names, doses, or prescribing instructions in any output. Medication decisions are
  the clinician's sole responsibility (INV-02). If medications were discussed, write "Medication plan discussed
  with the clinician" in the plan section.
- NEVER invent clinical findings, diagnoses, or recommendations not present in the transcript.
- Use the speaker tags to distinguish clinician statements from patient statements.
- If the transcript quality is poor or unintelligible, say so in the relevant section rather than guessing.
- Write in professional but accessible clinical English for the note sections.
- Write the patient summary in the language variant indicated (en-NG for Nigerian English).

Respond with the JSON object only.`;

export const SCRIBE_NOTE_SCHEMA = {
  type: "object",
  properties: {
    draft: {
      type: "object",
      properties: {
        history: { type: "string" },
        examination: { type: "string" },
        assessment: { type: "string" },
        plan: { type: "string" },
        followUp: { type: "string" },
      },
      required: ["history", "examination", "assessment", "plan", "followUp"],
      additionalProperties: false,
    },
    patientSummary: { type: "string" },
  },
  required: ["draft", "patientSummary"],
  additionalProperties: false,
};

export interface ScribeNoteDraft {
  readonly draft: {
    readonly history: string;
    readonly examination: string;
    readonly assessment: string;
    readonly plan: string;
    readonly followUp: string;
  };
  readonly patientSummary: string;
}

export type ScribeNoteResult =
  | { readonly ok: true; readonly note: ScribeNoteDraft; readonly model: string }
  | { readonly ok: false; readonly reason: string };

export function buildScribeUserMessage(
  transcript: string,
  source: "stt" | "typed" = "stt"
): string {
  return [
    "Language variant: en-NG",
    source === "typed" ? "Input type: notes the clinician typed or pasted about the consultation (not a recording)." : null,
    `Transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Never throws: a failed call is a result the evaluation records as a failure, not a crash. */
export async function generateScribeNote(
  transcript: string,
  source: "stt" | "typed" = "stt"
): Promise<ScribeNoteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: SCRIBE_CLAUDE_MODEL,
      max_tokens: SCRIBE_CLAUDE_MAX_TOKENS,
      system: SCRIBE_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCRIBE_NOTE_SCHEMA } },
      messages: [{ role: "user", content: buildScribeUserMessage(transcript, source) }],
    }),
  });
  if (!res.ok) return { ok: false, reason: `model call failed (${res.status})` };

  const body = (await res.json()) as {
    model: string;
    stop_reason: string;
    content: { type: string; text?: string }[];
  };
  const text = body.content.find((c) => c.type === "text")?.text;
  if (!text || body.stop_reason === "max_tokens") return { ok: false, reason: "empty or truncated response" };
  try {
    return { ok: true, note: JSON.parse(text) as ScribeNoteDraft, model: body.model };
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
}

// ---------------------------------------------------------------------------
// The two-stage "facts to confirm" path (S35c). Same prompts and schemas as the edge function's modes "facts" and
// "facts_draft" (they come from the one shared facts.ts), called here so the governance evaluation can exercise them.
// ---------------------------------------------------------------------------

async function callJson(system: string, schema: unknown, userMessage: string): Promise<{ ok: true; parsed: unknown; model: string } | { ok: false; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: SCRIBE_CLAUDE_MODEL,
      max_tokens: SCRIBE_CLAUDE_MAX_TOKENS,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) return { ok: false, reason: `model call failed (${res.status})` };
  const body = (await res.json()) as { model: string; stop_reason: string; content: { type: string; text?: string }[] };
  const text = body.content.find((c) => c.type === "text")?.text;
  if (!text || body.stop_reason === "max_tokens") return { ok: false, reason: "empty or truncated response" };
  try {
    return { ok: true, parsed: JSON.parse(text), model: body.model };
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
}

export type ScribeFactsResult =
  | { readonly ok: true; readonly facts: readonly ScribeFact[]; readonly dropped: number; readonly model: string }
  | { readonly ok: false; readonly reason: string };

/** Stage one. `sourceText` is the plain text the quotes are checked against (the transcript lines without timestamps). Never throws. */
export async function generateScribeFacts(
  language: "en-NG" | "pcm",
  transcript: string,
  sourceText: string,
  source: "stt" | "typed" = "stt",
): Promise<ScribeFactsResult> {
  const r = await callJson(FACTS_SYSTEM_PROMPT, FACTS_SCHEMA, buildFactsUserMessage(language, transcript, source === "typed"));
  if (!r.ok) return r;
  const verified = verifyFacts(r.parsed, sourceText);
  return { ok: true, facts: verified.facts, dropped: verified.dropped, model: r.model };
}

export type ScribeFactsDraftResult =
  | {
      readonly ok: true;
      readonly note: ScribeNoteDraft;
      readonly citations: Citations;
      readonly model: string;
    }
  | { readonly ok: false; readonly reason: string };

/** Stage two: the note from CONFIRMED facts only. Never throws. */
export async function generateScribeDraftFromFacts(
  language: "en-NG" | "pcm",
  facts: readonly ScribeFact[],
): Promise<ScribeFactsDraftResult> {
  const r = await callJson(FACTS_DRAFT_SYSTEM_PROMPT, FACTS_DRAFT_SCHEMA, buildFactsDraftUserMessage(language, facts, undefined));
  if (!r.ok) return r;
  const out = r.parsed as { draft?: ScribeNoteDraft["draft"]; patientSummary?: string; citations?: Citations };
  if (!out.draft || typeof out.patientSummary !== "string" || !out.citations) return { ok: false, reason: "incomplete response" };
  return { ok: true, note: { draft: out.draft, patientSummary: out.patientSummary }, citations: out.citations, model: r.model };
}
