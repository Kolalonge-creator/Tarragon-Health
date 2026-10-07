// S35c: the scribe's "facts to confirm" stage. Pure: no imports, no I/O, no clock, so the same text runs in the Deno edge function
// and in apps/web (apps/web/src/lib/scribe/facts.ts is a byte-identical copy, kept in step by scribe-facts-mirror.test.ts).
//
// Why a facts stage: published audits of AI notes find OMISSIONS the dominant error, and a fluent paragraph hides them
// (docs/research/S35.md). Stage one lists what was said as short typed facts, each with a verbatim quote; the clinician
// confirms, edits, rejects or adds facts; stage two writes the note from the CONFIRMED facts only and must cite them.
// Nothing here decides anything clinical, and nothing here is written to the patient record (INV-11): the facts are held
// in the browser, the draft still goes through the review step and the clinician's signature.
//
// Every check below is deterministic. A language model is never asked whether something was omitted: that is the task
// LLM judges perform at chance level (arXiv 2608.31016).

export const SCRIBE_FACTS_PROMPT_VERSION = "scribe-facts-v1";
export const SCRIBE_FACTS_DRAFT_PROMPT_VERSION = "scribe-facts-draft-v1";

export const FACT_TYPES = [
  "symptom",
  "negated_symptom",
  "allergy",
  "medication_mentioned",
  "measurement_or_finding",
  "history_item",
  "red_flag",
  "plan_item",
  "follow_up_item",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const MAX_FACTS = 60;
export const MAX_FACT_TEXT = 300;
export const MAX_FACT_QUOTE = 400;

export interface ScribeFact {
  readonly id: string;
  readonly type: FactType;
  readonly text: string;
  /** A verbatim span of what was said or typed. Empty only for a fact the clinician added by hand. */
  readonly quote: string;
  readonly speaker: "clinician" | "patient" | "unknown";
}

export const FACTS_SYSTEM_PROMPT = `You are an AI assistant for TarragonHealth, a Nigerian digital health platform.
You will receive a transcript, or typed notes, of a clinician-patient consultation.
Your only job is to LIST the facts that were stated, as short items. Do not write a note.

Rules:
- Record only what was said. Never add, infer, correct or guess. Never suggest a diagnosis, a test or a treatment.
- Every fact must carry a "quote": an exact, word-for-word span copied from the transcript that supports it. If you cannot quote it, leave the fact out.
- A symptom the patient says they do NOT have is its own fact, with type "negated_symptom", and the text must say "no" or "not" plainly. Never drop a negation.
- Record allergies, and every medicine the patient or clinician mentions, with the exact words used. A medicine mentioned is a fact to report back for the clinician to check; you are not recommending it.
- Record measurements and findings with their numbers and units exactly as stated.
- Record red-flag symptoms and the safety-netting advice that was given, and any follow-up that was agreed.
- Use the speaker tags to say who said it. Do not attribute a relative's words to the patient.
- If the transcript is poor or unintelligible, return fewer facts rather than guessing.
- Each fact text is one short sentence in plain clinical English.

Respond with the JSON object only.`;

export const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...FACT_TYPES] },
          text: { type: "string" },
          quote: { type: "string" },
          speaker: { type: "string", enum: ["clinician", "patient", "unknown"] },
        },
        required: ["type", "text", "quote", "speaker"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

export const FACTS_DRAFT_SYSTEM_PROMPT = `You are an AI clinical note assistant for TarragonHealth, a Nigerian digital health platform.
You will receive a numbered list of facts that the clinician has CONFIRMED from a consultation. This list is your only source.
Your job is to produce TWO outputs:

1. A structured clinical note draft with these sections: history, examination, assessment, plan, followUp.
2. A patient-facing summary in plain, warm language, without clinical jargon, in the language variant indicated.

CRITICAL RULES:
- Use ONLY the confirmed facts. Do not add anything that is not in them. If a section has no supporting fact, leave it as an empty string. Do not fill it.
- NEVER include medication names, doses, or prescribing instructions in any output. Medication decisions are the clinician's sole responsibility. If a medicine fact was confirmed, write "Medication plan discussed with the clinician" in the plan section.
- Every non-empty section must list, in "citations", the ids of the facts it uses. A section with no citations must be empty. Cite only ids from the list.
- Keep every negation: a fact that says "no" or "not" must read as a negative in the note.
- Copy numbers and units exactly as they appear in the facts. Never compute or round them.
- Write in professional but accessible clinical English for the note sections, and the patient summary in the language variant indicated (en-NG for Nigerian English, pcm for Pidgin).

Respond with the JSON object only.`;

const SECTION = { type: "array", items: { type: "string" } };
export const FACTS_DRAFT_SCHEMA = {
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
    citations: {
      type: "object",
      properties: { history: SECTION, examination: SECTION, assessment: SECTION, plan: SECTION, followUp: SECTION },
      required: ["history", "examination", "assessment", "plan", "followUp"],
      additionalProperties: false,
    },
  },
  required: ["draft", "patientSummary", "citations"],
  additionalProperties: false,
};

/** Lower case, punctuation to spaces, whitespace collapsed: the form used to look for a quote in the source text. */
export function normaliseForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VerifiedFacts {
  readonly facts: readonly ScribeFact[];
  /** Facts the model returned whose quote could not be found in the source. They are removed, and counted so the screen can say so. */
  readonly dropped: number;
}

/**
 * Keeps only facts whose quote really appears in the source text (after normalising both), with a known type and bounded
 * length; assigns stable ids f1, f2, ... in order. A fact with an invented quote is exactly the failure this stage is for,
 * so it is removed rather than shown.
 */
export function verifyFacts(raw: unknown, sourceText: string): VerifiedFacts {
  const list = Array.isArray((raw as { facts?: unknown } | null)?.facts) ? ((raw as { facts: unknown[] }).facts) : [];
  const haystack = normaliseForQuote(sourceText);
  const kept: ScribeFact[] = [];
  let dropped = 0;
  for (const item of list.slice(0, MAX_FACTS * 2)) {
    const f = item as Partial<ScribeFact> | null;
    const quote = typeof f?.quote === "string" ? f.quote.trim() : "";
    const text = typeof f?.text === "string" ? f.text.trim() : "";
    const speaker = f?.speaker === "clinician" || f?.speaker === "patient" || f?.speaker === "unknown" ? f.speaker : null;
    const typeOk = typeof f?.type === "string" && (FACT_TYPES as readonly string[]).includes(f.type);
    const needle = normaliseForQuote(quote);
    if (!typeOk || !speaker || text === "" || text.length > MAX_FACT_TEXT || quote.length > MAX_FACT_QUOTE || needle === "" || !haystack.includes(needle)) {
      dropped += 1;
      continue;
    }
    if (kept.length >= MAX_FACTS) {
      dropped += 1;
      continue;
    }
    kept.push({ id: `f${kept.length + 1}`, type: f!.type as FactType, text, quote, speaker });
  }
  return { facts: kept, dropped };
}

/** The user message for stage one. */
export function buildFactsUserMessage(language: "en-NG" | "pcm", transcript: string, typed: boolean): string {
  return [
    `Language variant: ${language}`,
    typed ? "Input type: notes the clinician typed or pasted about the consultation (not a recording)." : null,
    `Transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The user message for stage two: confirmed facts only, never the transcript. */
export function buildFactsDraftUserMessage(
  language: "en-NG" | "pcm",
  facts: readonly ScribeFact[],
  context: { age?: number; sex?: string; conditions?: readonly string[] } | undefined,
): string {
  const ctx: string[] = [];
  if (context?.age) ctx.push(`Age: ${context.age}`);
  if (context?.sex) ctx.push(`Sex: ${context.sex}`);
  if (context?.conditions?.length) ctx.push(`Known conditions: ${context.conditions.join(", ")}`);
  return [
    `Language variant: ${language}`,
    ctx.length ? `Patient context:\n${ctx.join("\n")}` : null,
    `Confirmed facts:\n${facts.map((f) => `${f.id} [${f.type}] ${f.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type Citations = Readonly<Record<"history" | "examination" | "assessment" | "plan" | "followUp", readonly string[]>>;
export interface GroundingWarning {
  readonly section: string;
  readonly kind: "uncited_text" | "unknown_fact_id" | "number_not_in_facts" | "empty_but_cited";
  readonly detail?: string;
}

const SECTIONS = ["history", "examination", "assessment", "plan", "followUp"] as const;

function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

/**
 * Deterministic checks on a draft written from confirmed facts: every non-empty section cites at least one fact, every
 * cited id is one the clinician confirmed, a section with no text cites nothing, and every number in a section appears in
 * the confirmed facts (a number the facts do not contain was invented or computed). Returned as warnings the review
 * screen shows; the clinician still reviews and signs everything.
 */
export function groundingWarnings(
  draft: Readonly<Record<(typeof SECTIONS)[number], string>>,
  citations: Citations,
  facts: readonly ScribeFact[],
): GroundingWarning[] {
  const ids = new Set(facts.map((f) => f.id));
  const factNumbers = new Set(numbersIn(facts.map((f) => f.text).join(" ")));
  const out: GroundingWarning[] = [];
  for (const section of SECTIONS) {
    const text = (draft[section] ?? "").trim();
    const cited = citations[section] ?? [];
    if (text === "" && cited.length > 0) out.push({ section, kind: "empty_but_cited" });
    if (text !== "" && cited.length === 0) out.push({ section, kind: "uncited_text" });
    for (const id of cited) if (!ids.has(id)) out.push({ section, kind: "unknown_fact_id", detail: id });
    for (const n of numbersIn(text)) if (!factNumbers.has(n)) out.push({ section, kind: "number_not_in_facts", detail: n });
  }
  return out;
}
