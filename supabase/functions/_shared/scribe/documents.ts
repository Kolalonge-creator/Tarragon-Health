// S76-S80: draft kinds beyond the note and patient summary. Pure: no imports, no I/O, no clock, so the same text runs in the Deno edge function
// and in apps/web (apps/web/src/lib/scribe/documents.ts is a byte-identical copy of supabase/functions/_shared/scribe/documents.ts, kept in
// step by scribe-documents-mirror.test.ts).
//
// Three kinds, all written from facts the clinician CONFIRMED (the transcript is not sent again):
//   letter                 a short letter for the clinician to edit. Held in the browser; nothing is stored or sent.
//   prescription_proposal  a PROPOSAL the clinician reads and, if right, enters in the existing prescribing form. It never creates a
//                          prescription (INV-02): there is no write path from here to any medication table.
//   follow_up_tasks        proposed follow-up tasks. A task becomes a clinical_follow_ups row only when the clinician accepts it.
// Every draft carries the watermark below until a clinician acts on it. The model's output is only trusted after the deterministic checks
// here: a proposal must cite a confirmed fact and a medicine must be named in the confirmed facts.

export const DOCUMENT_PROMPT_VERSION = "scribe-documents-v1";
export const DOCUMENT_WATERMARK = "AI-drafted, unsigned";

export const DOCUMENT_KINDS = ["letter", "prescription_proposal", "follow_up_tasks"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const MAX_LETTER_CHARS = 4000;
export const MAX_PROPOSALS = 10;
export const MAX_PROPOSAL_TEXT = 200;
export const MAX_TASK_DAYS = 180;

export interface DocumentFact {
  readonly id: string;
  readonly text: string;
  readonly quote: string;
}

export interface PrescriptionProposalItem {
  readonly medicine: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly reason: string;
  readonly sourceFactId: string;
}
export interface FollowUpTaskItem {
  readonly description: string;
  readonly dueInDays: number;
  readonly sourceFactId: string;
}
export type DocumentDraft =
  | { readonly kind: "letter"; readonly body: string }
  | { readonly kind: "prescription_proposal"; readonly items: readonly PrescriptionProposalItem[]; readonly dropped: number }
  | { readonly kind: "follow_up_tasks"; readonly items: readonly FollowUpTaskItem[]; readonly dropped: number };

/** Default instruction per kind. The governed copy (ai_prompt_versions, approved by a human) is what runs; these seed it and are unapproved. */
export const DOCUMENT_COMMON_PROMPT = `You write drafts for a clinician at TarragonHealth, a Nigerian digital health platform.
You receive a list of facts the clinician has already confirmed from a consultation, each with an id.
Use ONLY those facts. Never add a finding, diagnosis, medicine, dose or date that is not in them. If a fact is missing, leave the field out.
Everything you write is a draft for the clinician to check and change. It is not a prescription, an order or a letter that has been sent.
Respond with the JSON object only.`;

export const DOCUMENT_KIND_INSTRUCTIONS: Readonly<Record<DocumentKind, string>> = {
  letter:
    "Write a short, plain letter from the clinician about this consultation, for the patient or for another clinician. Warm, clear, no jargon, no more than 250 words. Do not state a medicine or dose unless a confirmed fact states it.",
  prescription_proposal:
    "List only medicines that a confirmed fact says were discussed or planned. For each give medicine, dose, frequency, duration and the reason, copied from the facts; use an empty string for anything the facts do not say. Cite the id of the fact each item comes from. Propose nothing that is not in the facts.",
  follow_up_tasks:
    "List the follow-up actions a confirmed fact says were planned (a review, a test, a call, a referral to chase). For each give a short description, how many days from today it is due, and the id of the fact it comes from. If the facts give no timing, use 14.",
};

export const DOCUMENT_SCHEMAS: Readonly<Record<DocumentKind, unknown>> = {
  letter: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
    additionalProperties: false,
  },
  prescription_proposal: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            medicine: { type: "string" },
            dose: { type: "string" },
            frequency: { type: "string" },
            duration: { type: "string" },
            reason: { type: "string" },
            sourceFactId: { type: "string" },
          },
          required: ["medicine", "dose", "frequency", "duration", "reason", "sourceFactId"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  follow_up_tasks: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            dueInDays: { type: "integer" },
            sourceFactId: { type: "string" },
          },
          required: ["description", "dueInDays", "sourceFactId"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

export function buildDocumentUserMessage(kind: DocumentKind, facts: readonly DocumentFact[], context?: { age?: number; sex?: string; conditions?: readonly string[] }): string {
  const ctx: string[] = [];
  if (context?.age !== undefined) ctx.push(`Age: ${context.age}`);
  if (context?.sex) ctx.push(`Sex: ${context.sex}`);
  if (context?.conditions?.length) ctx.push(`Known conditions: ${context.conditions.join(", ")}`);
  return [
    "Language variant: en-NG",
    `Draft kind: ${kind}`,
    ctx.length ? `Patient context:\n${ctx.join("\n")}` : null,
    `Confirmed facts:\n${facts.map((f) => `[${f.id}] ${f.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v.trim() : null;
}

/**
 * Checks the model's output. Returns null when the shape is wrong (the caller reports an incomplete response). Items that fail a
 * grounding check are dropped and counted, never repaired: a proposal must cite a confirmed fact, and a medicine must be named in the
 * confirmed facts it cites. maxTaskDays comes from PROPOSED config on the web side; the edge function passes MAX_TASK_DAYS.
 */
export function validateDocument(kind: DocumentKind, parsed: unknown, facts: readonly DocumentFact[], maxTaskDays: number = MAX_TASK_DAYS): DocumentDraft | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (kind === "letter") {
    const body = str(obj.body, MAX_LETTER_CHARS);
    return body ? { kind, body } : null;
  }
  if (!Array.isArray(obj.items)) return null;
  const byId = new Map(facts.map((f) => [f.id, f]));
  let dropped = 0;
  if (kind === "prescription_proposal") {
    const items: PrescriptionProposalItem[] = [];
    for (const raw of obj.items.slice(0, MAX_PROPOSALS * 2)) {
      const r = raw as Record<string, unknown>;
      const medicine = str(r?.medicine, MAX_PROPOSAL_TEXT);
      const dose = str(r?.dose, MAX_PROPOSAL_TEXT);
      const frequency = str(r?.frequency, MAX_PROPOSAL_TEXT);
      const duration = str(r?.duration, MAX_PROPOSAL_TEXT);
      const reason = str(r?.reason, MAX_PROPOSAL_TEXT);
      const sourceFactId = str(r?.sourceFactId, 20);
      const fact = sourceFactId ? byId.get(sourceFactId) : undefined;
      const named = medicine && fact ? norm(`${fact.text} ${fact.quote}`).includes(norm(medicine)) : false;
      if (!medicine || dose === null || frequency === null || duration === null || reason === null || !fact || !named || items.length >= MAX_PROPOSALS) {
        dropped++;
        continue;
      }
      items.push({ medicine, dose, frequency, duration, reason, sourceFactId: fact.id });
    }
    return { kind, items, dropped };
  }
  const items: FollowUpTaskItem[] = [];
  for (const raw of obj.items.slice(0, MAX_PROPOSALS * 2)) {
    const r = raw as Record<string, unknown>;
    const description = str(r?.description, MAX_PROPOSAL_TEXT);
    const days = r?.dueInDays;
    const sourceFactId = str(r?.sourceFactId, 20);
    const fact = sourceFactId ? byId.get(sourceFactId) : undefined;
    if (!description || typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > maxTaskDays || !fact || items.length >= MAX_PROPOSALS) {
      dropped++;
      continue;
    }
    items.push({ description, dueInDays: days, sourceFactId: fact.id });
  }
  return { kind: "follow_up_tasks", items, dropped };
}

/** Plain text of a letter with the watermark on top, for copying out of the screen. */
export function watermarkedText(body: string): string {
  return `[${DOCUMENT_WATERMARK}]\n\n${body}`;
}
