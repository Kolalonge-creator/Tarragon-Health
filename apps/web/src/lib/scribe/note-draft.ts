/**
 * The scribe's model call, as a plain function so the governance evaluation (ai-governance/run-scribe-eval-suites.ts)
 * exercises the same prompt, schema and model as the production edge function (supabase/functions/scribe-draft).
 * A Deno function cannot import from apps/web, so the three constants below are mirrored from the edge function and
 * scribe-draft-mirror.test.ts fails if they ever drift apart.
 */

export const SCRIBE_CLAUDE_MODEL = "claude-sonnet-5-5";
export const SCRIBE_CLAUDE_MAX_TOKENS = 4096;

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
- Write the patient summary in the language variant indicated (en-NG for Nigerian English, pcm for Pidgin).

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

export function buildScribeUserMessage(language: "en-NG" | "pcm", transcript: string): string {
  return [`Language variant: ${language}`, `Transcript:\n${transcript}`].join("\n\n");
}

/** Never throws: a failed call is a result the evaluation records as a failure, not a crash. */
export async function generateScribeNote(language: "en-NG" | "pcm", transcript: string): Promise<ScribeNoteResult> {
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
      messages: [{ role: "user", content: buildScribeUserMessage(language, transcript) }],
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
