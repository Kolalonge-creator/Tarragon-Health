// S23: POST /functions/v1/scribe-draft
// Takes an encrypted transcript + patient context, calls Claude to produce a structured clinical note draft and a
// patient-facing summary. The caller (clinician UI) decrypts the transcript client-side and sends plaintext segments.
//
// INV-11: the draft is NOT written to the patient record here. It is returned to the clinician for review, editing and
//         signing. The clinician's server action writes the signed version.
// INV-02: the prompt explicitly forbids medication/prescribing instructions in the draft output.
// AI governance: AI-017 scribeDraft. The edge function checks ai_systems.is_enabled before calling Claude.
//               If disabled, returns { status: "disabled" } so the UI can fall back to manual note entry.
import { createClient } from "jsr:@supabase/supabase-js@2";

interface TranscriptSegment {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speaker: "clinician" | "patient" | "unknown";
}

interface RequestBody {
  readonly scribeConsentId: string;
  readonly encounterNoteId: string;
  readonly segments: readonly TranscriptSegment[];
  readonly language: "en-NG" | "pcm";
  // "typed": the clinician pasted or typed notes of the consultation (no recording, so no timestamps).
  readonly source?: "stt" | "typed";
  readonly patientContext?: {
    readonly age?: number;
    readonly sex?: string;
    readonly conditions?: readonly string[];
  };
}

interface DraftSection {
  readonly history: string;
  readonly examination: string;
  readonly assessment: string;
  readonly plan: string;
  readonly followUp: string;
}

interface DraftResponse {
  readonly status: "ok";
  readonly draft: DraftSection;
  readonly patientSummary: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// Mirrors packages/shared/src/proposed-config (scribe.claude_model, scribe.claude_max_tokens). A Deno function cannot
// import the registry, so scribe-mirror.test.ts asserts these two literals equal the registry values.
const SCRIBE_CLAUDE_MODEL = "claude-sonnet-5-5";
const SCRIBE_CLAUDE_MAX_TOKENS = 4096;

const MAX_SEGMENTS = 2000;
const MAX_SEGMENT_CHARS = 2000;
const MAX_CONDITIONS = 20;
const MAX_CONDITION_CHARS = 100;

const SYSTEM_PROMPT = `You are an AI clinical note assistant for TarragonHealth, a Nigerian digital health platform.
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

// Schema-constrained output: the API returns text that is guaranteed to be JSON matching this schema, so there is no
// free-text JSON to mis-parse (a plain "respond with JSON" prompt produced an unparseable reply in live testing).
const NOTE_SCHEMA = {
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


function validSegments(segments: readonly TranscriptSegment[]): boolean {
  return (
    segments.length <= MAX_SEGMENTS &&
    segments.every(
      (s) =>
        typeof s.text === "string" &&
        s.text.length <= MAX_SEGMENT_CHARS &&
        Number.isFinite(s.startMs) &&
        ["clinician", "patient", "unknown"].includes(s.speaker),
    )
  );
}

function validContext(ctx: RequestBody["patientContext"]): boolean {
  if (!ctx) return true;
  if (ctx.age !== undefined && !(Number.isInteger(ctx.age) && ctx.age >= 0 && ctx.age <= 130)) return false;
  if (ctx.sex !== undefined && (typeof ctx.sex !== "string" || ctx.sex.length > 20)) return false;
  if (ctx.conditions !== undefined) {
    if (!Array.isArray(ctx.conditions) || ctx.conditions.length > MAX_CONDITIONS) return false;
    if (!ctx.conditions.every((c) => typeof c === "string" && c.length <= MAX_CONDITION_CHARS)) return false;
  }
  return true;
}

function formatTranscript(segments: readonly TranscriptSegment[], typed: boolean): string {
  return segments
    .map((s) => {
      if (typed) return `${s.speaker.toUpperCase()}: ${s.text}`;
      const mins = Math.floor(s.startMs / 60000);
      const secs = Math.floor((s.startMs % 60000) / 1000);
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      return `[${ts}] ${s.speaker.toUpperCase()}: ${s.text}`;
    })
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });

  // Validate request body.
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.scribeConsentId || !body.encounterNoteId || !body.segments?.length) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!["en-NG", "pcm"].includes(body.language)) {
    return Response.json({ error: "unsupported_language" }, { status: 400 });
  }

  if (body.source !== undefined && !["stt", "typed"].includes(body.source)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const typed = body.source === "typed";

  if (!validSegments(body.segments) || !validContext(body.patientContext)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // Supabase client with the caller's JWT.
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  // AI governance gate: check ai_systems.is_enabled for AI-017.
  const { data: aiCheck, error: aiError } = await client.rpc("ai_runtime_config", { p_system_code: "AI-017" });
  if (aiError || !aiCheck || aiCheck.registered !== true) {
    return Response.json({ status: "disabled", reason: "governance_unavailable" });
  }
  if (aiCheck.enabled !== true) {
    return Response.json({ status: "disabled", reason: "system_off" });
  }

  const { data: userData } = await client.auth.getUser();
  const actorId = userData.user?.id ?? null;

  // Verify the consent row exists and is granted (not revoked).
  const { data: consent, error: consentErr } = await client
    .from("scribe_consents")
    .select("id, granted, revoked_at, organisation_id, patient_id, encounter_note_id")
    .eq("id", body.scribeConsentId)
    .maybeSingle();

  if (consentErr || !consent) {
    return Response.json({ error: "consent_not_found" }, { status: 404 });
  }
  if (!consent.granted || consent.revoked_at) {
    return Response.json({ error: "consent_not_active" }, { status: 403 });
  }
  // INV-11: consent is per-encounter. A consent recorded for another encounter (or none) cannot be reused here.
  if (consent.encounter_note_id !== body.encounterNoteId) {
    return Response.json({ error: "consent_encounter_mismatch" }, { status: 403 });
  }

  // Build the Claude prompt.
  const transcript = formatTranscript(body.segments, typed);
  const contextParts: string[] = [];
  if (body.patientContext?.age) contextParts.push(`Age: ${body.patientContext.age}`);
  if (body.patientContext?.sex) contextParts.push(`Sex: ${body.patientContext.sex}`);
  if (body.patientContext?.conditions?.length) {
    contextParts.push(`Known conditions: ${body.patientContext.conditions.join(", ")}`);
  }

  const userMessage = [
    `Language variant: ${body.language}`,
    typed ? "Input type: notes the clinician typed or pasted about the consultation (not a recording)." : null,
    contextParts.length ? `Patient context:\n${contextParts.join("\n")}` : null,
    `Transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Call Claude.
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "anthropic_key_missing" }, { status: 500 });
  }

  const startedAt = Date.now();

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SCRIBE_CLAUDE_MODEL,
        max_tokens: SCRIBE_CLAUDE_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: NOTE_SCHEMA } },
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!apiRes.ok) {
      console.error("scribe-draft: Claude call failed", apiRes.status, await apiRes.text());
      return Response.json({ error: "model_call_failed" }, { status: 502 });
    }
    const response = (await apiRes.json()) as {
      model: string;
      stop_reason: string;
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = response.content.find((c) => c.type === "text")?.text;
    if (!text || response.stop_reason === "max_tokens") {
      return Response.json({ error: "empty_response" }, { status: 502 });
    }
    let parsed: { draft: DraftSection; patientSummary: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json({ error: "unparseable_response" }, { status: 502 });
    }

    if (!parsed.draft?.history || !parsed.draft?.assessment || !parsed.patientSummary) {
      return Response.json({ error: "incomplete_response" }, { status: 502 });
    }

    // Record the interaction in ai_interaction_log. Fail closed: a draft with no audit row is not returned.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { error: logError } = await serviceClient.from("ai_interaction_log").insert({
      organisation_id: consent.organisation_id,
      ai_system_id: aiCheck.system_id,
      model_identifier: response.model,
      subject_profile_id: consent.patient_id,
      actor_profile_id: actorId,
      input_category: typed ? "scribe_typed_notes" : "scribe_transcript",
      output_summary: `Draft: ${Object.keys(parsed.draft).length} sections + patient summary (${body.language}${typed ? ", typed notes" : ""})`,
      status: "completed",
      resulting_action: "draft_generated",
      resulting_entity_type: "clinical_encounter_note",
      resulting_entity_id: body.encounterNoteId,
      latency_ms: Date.now() - startedAt,
      input_token_count: response.usage.input_tokens,
      output_token_count: response.usage.output_tokens,
    });
    if (logError) {
      console.error("scribe-draft: audit log insert failed", logError);
      return Response.json({ error: "audit_unavailable" }, { status: 500 });
    }

    const result: DraftResponse = {
      status: "ok",
      draft: parsed.draft,
      patientSummary: parsed.patientSummary,
      modelId: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    return Response.json(result);
  } catch (err) {
    console.error("scribe-draft: Claude call failed", err);
    return Response.json({ error: "model_call_failed" }, { status: 502 });
  }
});
