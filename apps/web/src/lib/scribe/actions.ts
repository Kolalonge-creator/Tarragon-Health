"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";
import { MAX_SEGMENT_CHARS, MAX_TYPED_NOTES_CHARS, MIN_TYPED_NOTES_CHARS, parseTypedNotes } from "./parse-typed-notes";
import { z } from "zod";
import { loose } from "@/lib/clinician/loose-client";
import { consentStateSchema } from "./consent-state";
import { FACT_TYPES, MAX_FACTS, MAX_FACT_QUOTE, MAX_FACT_TEXT } from "./facts";
import { DOCUMENT_KINDS } from "./documents";
import { DRAFT_SECTION_KEYS } from "./draft-review";
import { problemReportSchema } from "./problem-report";
import { getProposedConfig } from "@tarragon/shared";

// One definition of the context the model may see, used by both the recorded and the typed path.
/** The only language the scribe records and drafts in. Stored as-is in the scribe tables. */
const SCRIBE_LANGUAGE = "en-NG";

const PatientContextSchema = z
  .object({
    age: z.number().int().min(0).max(130).optional(),
    sex: z.string().max(20).optional(),
    conditions: z.array(z.string().max(100)).max(20).optional(),
  })
  .optional();

const RecordConsentSchema = z.object({
  patientId: z.string().uuid(),
  encounterNoteId: z.string().uuid().optional(),
  granted: z.boolean(),
});

export async function recordScribeConsent(input: z.input<typeof RecordConsentSchema>) {
  const parsed = RecordConsentSchema.parse(input);
  const supabase = await createClient();

  // The insert trigger stamps clinician_profile_id, clinician_staff_id and organisation_id (never client-supplied), so
  // the generated Insert type, which cannot see triggers, is satisfied by assertion rather than by sending them.
  const row = {
    patient_id: parsed.patientId,
    encounter_note_id: parsed.encounterNoteId ?? null,
    granted: parsed.granted,
    language: SCRIBE_LANGUAGE,
  } as Database["public"]["Tables"]["scribe_consents"]["Insert"];

  const { data, error } = await supabase
    .from("scribe_consents")
    .insert(row)
    .select("id")
    .single();

  // A result, not a thrown error: Next redacts the message of anything a Server Action throws in production, so the screen could not
  // tell "the patient has not allowed it in the app" (S21g, OQ-161: the database refuses, SQLSTATE 42501) from any other failure.
  if (error) return { ok: false as const, reason: error.code === "42501" ? ("not_allowed" as const) : ("failed" as const) };
  return { ok: true as const, id: data.id };
}

export async function revokeScribeConsent(consentId: string) {
  const id = z.string().uuid().parse(consentId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("scribe_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  // Revocation cleanup: the patient withdrew, so the captured transcript is removed rather than left to expire.
  const { error: cleanupError } = await supabase.from("scribe_transcripts").delete().eq("scribe_consent_id", id);
  if (cleanupError) throw new Error(cleanupError.message);
}

const AttachDraftSchema = z.object({
  encounterNoteId: z.string().uuid(),
  scribeConsentId: z.string().uuid(),
  patientSummary: z.string().max(4000),
});

/**
 * Records on a draft encounter note that its text came from the AI scribe: the consent it was made under, the patient
 * summary and ai_drafted. Notes are written only through audited functions (INV-10), so this calls
 * attach_scribe_draft_to_note, which re-checks that the consent is still granted, unrevoked and for this note and
 * patient (INV-11). Signing stays the note's own Sign and finalise step, which still needs an outcome and identity
 * confirmation.
 */
export async function attachScribeDraftToNote(input: z.input<typeof AttachDraftSchema>) {
  const parsed = AttachDraftSchema.parse(input);
  const supabase = await createClient();

  const { error } = await supabase.rpc("attach_scribe_draft_to_note", {
    p_note: parsed.encounterNoteId,
    p_consent: parsed.scribeConsentId,
    p_patient_summary: parsed.patientSummary,
    p_summary_language: SCRIBE_LANGUAGE,
  });
  if (error) throw new Error(error.message);
}

/**
 * S64 (15.4): the clinician confirms they read the allergy and medicine lines of an AI draft. The database will not sign an
 * ai_drafted note without this (and clears it on any later edit), so this must run AFTER the final save and BEFORE signing. A
 * refusal is thrown, never swallowed: if the check cannot be recorded the note is not signed.
 */
export async function confirmScribeSafetyLines(noteId: string) {
  const id = z.string().uuid().parse(noteId);
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("confirm_scribe_safety_lines", { p_note: id });
  if (error) throw new Error(error.message);
}

const CallDraftSchema = z.object({
  scribeConsentId: z.string().uuid(),
  encounterNoteId: z.string().uuid(),
  segments: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        text: z.string().max(MAX_SEGMENT_CHARS),
        speaker: z.enum(["clinician", "patient", "unknown"]),
      }),
    )
    .min(1)
    .max(2000),
  source: z.enum(["stt", "typed"]).default("stt"),
  patientContext: PatientContextSchema,
});

export async function callScribeDraft(rawInput: z.input<typeof CallDraftSchema>) {
  const input = CallDraftSchema.parse(rawInput);
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");

  const res = await fetch(`${supabaseUrl}/functions/v1/scribe-draft`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `scribe-draft failed: ${res.status}`);
  }

  return res.json();
}

const DraftFromTextSchema = z.object({
  scribeConsentId: z.string().uuid(),
  encounterNoteId: z.string().uuid(),
  text: z.string().min(MIN_TYPED_NOTES_CHARS).max(MAX_TYPED_NOTES_CHARS),
  patientContext: PatientContextSchema,
});

/** Drafts a note from consultation notes the clinician pasted or typed. The text is sent to the model and not stored. */
export async function draftScribeFromText(input: z.input<typeof DraftFromTextSchema>) {
  const parsed = DraftFromTextSchema.parse(input);
  const segments = parseTypedNotes(parsed.text);
  if (segments.length === 0) throw new Error("There is no text to draft from.");
  return callScribeDraft({
    scribeConsentId: parsed.scribeConsentId,
    encounterNoteId: parsed.encounterNoteId,
    segments,
    source: "typed",
    patientContext: parsed.patientContext,
  });
}

/** The patient's own answer for this note's consultation. Fails closed: an unreadable answer is an error, never "given". */
export async function getScribeConsentState(noteId: string) {
  const id = z.string().uuid().parse(noteId);
  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("scribe_consent_state", { p_note: id });
  if (error) throw new Error(error.message);
  return consentStateSchema.parse(data);
}

const RecordReviewSchema = z.object({
  noteId: z.string().uuid(),
  consentId: z.string().uuid(),
  model: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(40),
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.enum(["stt", "typed"]),
  sections: z.record(
    z.string(),
    z.object({ state: z.enum(["unchanged", "edited", "emptied", "added", "empty_kept"]), flagged_empty: z.boolean() }),
  ),
});

/**
 * Records what the clinician did with each section of the AI draft (S35c). Called just before a note is signed, so
 * the outcomes describe the text that is about to be signed. Per-section outcome and a hash of the draft as
 * generated; no draft text. The database re-checks that the consent is active for this note.
 */
export async function recordScribeReview(input: z.input<typeof RecordReviewSchema>) {
  const parsed = RecordReviewSchema.parse(input);
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("record_scribe_review", {
    p_note: parsed.noteId,
    p_consent: parsed.consentId,
    p_model: parsed.model,
    p_prompt_version: parsed.promptVersion,
    p_draft_hash: parsed.draftHash,
    p_source: parsed.source,
    p_sections: parsed.sections,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// The two-stage path (S35c): list the facts, the clinician confirms them, then write the note from the confirmed facts only.
// ---------------------------------------------------------------------------

async function postScribe(body: Record<string, unknown>): Promise<unknown> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  const res = await fetch(`${supabaseUrl}/functions/v1/scribe-draft`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const failure = await res.json().catch(() => ({}));
    throw new Error(failure.error ?? `scribe-draft failed: ${res.status}`);
  }
  return res.json();
}

const factSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,20}$/i),
  type: z.enum(FACT_TYPES),
  text: z.string().min(1).max(MAX_FACT_TEXT),
  quote: z.string().max(MAX_FACT_QUOTE),
  speaker: z.enum(["clinician", "patient", "unknown"]),
});

const factsResponseSchema = z.union([
  z.object({ status: z.literal("disabled"), reason: z.string().optional() }),
  z.object({
    status: z.literal("ok"),
    facts: z.array(factSchema),
    droppedUnverified: z.number().int().nonnegative(),
    modelId: z.string(),
    promptVersion: z.string(),
  }),
]);

const FindFactsSchema = z.object({
  scribeConsentId: z.string().uuid(),
  encounterNoteId: z.string().uuid(),
  language: z.enum(["en-NG", "pcm"]),
  text: z.string().min(MIN_TYPED_NOTES_CHARS).max(MAX_TYPED_NOTES_CHARS),
});

/** Stage one for pasted or typed notes: the facts said, each with a quote the server has checked against the text. Nothing is stored. */
export async function findScribeFactsFromText(input: z.input<typeof FindFactsSchema>) {
  const parsed = FindFactsSchema.parse(input);
  const segments = parseTypedNotes(parsed.text);
  if (segments.length === 0) throw new Error("There is no text to read facts from.");
  const out = await postScribe({
    mode: "facts",
    scribeConsentId: parsed.scribeConsentId,
    encounterNoteId: parsed.encounterNoteId,
    segments,
    language: parsed.language,
    source: "typed",
  });
  return factsResponseSchema.parse(out);
}

const draftFromFactsResponseSchema = z.union([
  z.object({ status: z.literal("disabled"), reason: z.string().optional() }),
  z.object({
    status: z.literal("ok"),
    draft: z.object({ history: z.string(), examination: z.string(), assessment: z.string(), plan: z.string(), followUp: z.string() }),
    patientSummary: z.string(),
    groundingWarnings: z.array(z.object({ section: z.string(), kind: z.string(), detail: z.string().optional() })),
    modelId: z.string(),
    promptVersion: z.string(),
  }),
]);

const DraftFromFactsSchema = z.object({
  scribeConsentId: z.string().uuid(),
  encounterNoteId: z.string().uuid(),
  language: z.enum(["en-NG", "pcm"]),
  confirmedFacts: z.array(factSchema).min(1).max(MAX_FACTS + 10),
  patientContext: PatientContextSchema,
});

/** Stage two: the note from the facts the clinician confirmed, and only those. */
export async function draftScribeFromFacts(input: z.input<typeof DraftFromFactsSchema>) {
  const parsed = DraftFromFactsSchema.parse(input);
  const out = await postScribe({
    mode: "facts_draft",
    scribeConsentId: parsed.scribeConsentId,
    encounterNoteId: parsed.encounterNoteId,
    confirmedFacts: parsed.confirmedFacts,
    language: parsed.language,
    // the facts came from pasted or typed notes: the audit log records the input category from this
    source: "typed",
    patientContext: parsed.patientContext,
  });
  return draftFromFactsResponseSchema.parse(out);
}

// ---------------------------------------------------------------------------
// S76-S80: the stored edit diff, problem reports, and the draft kinds beyond the note.
// ---------------------------------------------------------------------------

const sectionDiffSchema = z.object({
  draft_words: z.number().int().nonnegative(),
  signed_words: z.number().int().nonnegative(),
  words_added: z.number().int().nonnegative(),
  words_removed: z.number().int().nonnegative(),
  ops: z.array(
    z.union([
      z.object({ op: z.literal("eq"), n: z.number().int().positive() }),
      z.object({ op: z.literal("del"), text: z.string() }),
      z.object({ op: z.literal("ins"), text: z.string() }),
    ]),
  ),
});

const RecordSignedDiffSchema = z.object({
  noteId: z.string().uuid(),
  consentId: z.string().uuid(),
  transcriptHash: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(40),
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.enum(["stt", "typed"]),
  aiDraft: z.object(Object.fromEntries(DRAFT_SECTION_KEYS.map((k) => [k, z.string().max(20000)])) as Record<(typeof DRAFT_SECTION_KEYS)[number], z.ZodString>),
  diff: z.object(Object.fromEntries(DRAFT_SECTION_KEYS.map((k) => [k, sectionDiffSchema])) as Record<(typeof DRAFT_SECTION_KEYS)[number], typeof sectionDiffSchema>),
});

/**
 * Stores the AI draft, the text about to be signed (the database reads that from the note itself) and the word-level diff. Called right after
 * recordScribeReview and before signing. Fails closed like the review record: a refusal is thrown and the note is not signed.
 */
export async function recordScribeSignedDiff(input: z.input<typeof RecordSignedDiffSchema>) {
  const parsed = RecordSignedDiffSchema.parse(input);
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("record_scribe_signed_diff", {
    p_note: parsed.noteId,
    p_consent: parsed.consentId,
    p_transcript_hash: parsed.transcriptHash,
    p_model: parsed.model,
    p_prompt_version: parsed.promptVersion,
    p_draft_hash: parsed.draftHash,
    p_source: parsed.source,
    p_ai_draft: parsed.aiDraft,
    p_diff: parsed.diff,
  });
  if (error) throw new Error(error.message);
}

/** "Report a problem with this draft". A result, not a thrown error, so the screen can say it failed without losing the draft. */
export async function reportScribeProblem(input: z.input<typeof problemReportSchema>) {
  const parsed = problemReportSchema.parse(input);
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("report_scribe_draft_problem", {
    p_note: parsed.noteId,
    p_consent: parsed.consentId,
    p_kind: parsed.draftKind,
    p_section: parsed.section,
    p_category: parsed.category,
    p_comment: parsed.comment ?? null,
  });
  return error ? { ok: false as const } : { ok: true as const };
}

const documentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("letter"), body: z.string() }),
  z.object({
    kind: z.literal("prescription_proposal"),
    dropped: z.number().int().nonnegative(),
    items: z.array(z.object({ medicine: z.string(), dose: z.string(), frequency: z.string(), duration: z.string(), reason: z.string(), sourceFactId: z.string() })),
  }),
  z.object({
    kind: z.literal("follow_up_tasks"),
    dropped: z.number().int().nonnegative(),
    items: z.array(z.object({ description: z.string(), dueInDays: z.number().int(), sourceFactId: z.string() })),
  }),
]);
const documentResponseSchema = z.union([
  z.object({ status: z.literal("disabled"), reason: z.string().optional() }),
  z.object({ status: z.literal("ok"), document: documentSchema, modelId: z.string(), promptVersion: z.string() }),
]);

const DraftDocumentSchema = z.object({
  scribeConsentId: z.string().uuid(),
  encounterNoteId: z.string().uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  confirmedFacts: z.array(factSchema).min(1).max(MAX_FACTS + 10),
  patientContext: PatientContextSchema,
});

/**
 * A letter, prescription proposal or follow-up task list from the facts the clinician confirmed. Nothing is stored. The edge function
 * answers "disabled" until a human has approved the governed prompt for these kinds.
 */
export async function draftScribeDocument(input: z.input<typeof DraftDocumentSchema>) {
  const parsed = DraftDocumentSchema.parse(input);
  const out = await postScribe({
    mode: "document",
    documentKind: parsed.kind,
    scribeConsentId: parsed.scribeConsentId,
    encounterNoteId: parsed.encounterNoteId,
    confirmedFacts: parsed.confirmedFacts,
    source: "typed",
    patientContext: parsed.patientContext,
  });
  return documentResponseSchema.parse(out);
}

const AcceptTaskSchema = z.object({
  patientId: z.string().uuid(),
  dueInDays: z.number().int().min(1),
});

/**
 * The clinician accepts one drafted follow-up task: only now is a clinical_follow_ups row created, through the existing function (which checks
 * the clinician is tied to the patient). The row holds ids and a due time only, so the drafted wording is not stored there.
 */
export async function acceptFollowUpTaskProposal(input: z.input<typeof AcceptTaskSchema>) {
  const parsed = AcceptTaskSchema.parse(input);
  const max = getProposedConfig<{ follow_up_task_max_days: number }>("scribe.review_rules").value.follow_up_task_max_days;
  if (parsed.dueInDays > max) return { ok: false as const, reason: "too_far" as const };
  const supabase = loose(await createClient());
  const due = new Date(Date.now() + parsed.dueInDays * 86_400_000).toISOString();
  const { error } = await supabase.rpc("create_clinical_follow_up", { p_patient: parsed.patientId, p_kind: "follow_up", p_due_at: due });
  return error ? { ok: false as const, reason: "refused" as const } : { ok: true as const };
}
