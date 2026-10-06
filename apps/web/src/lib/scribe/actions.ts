"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";
import { z } from "zod";

const RecordConsentSchema = z.object({
  patientId: z.string().uuid(),
  encounterNoteId: z.string().uuid().optional(),
  granted: z.boolean(),
  language: z.enum(["en-NG", "pcm"]),
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
    language: parsed.language,
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

const SignDraftSchema = z.object({
  encounterNoteId: z.string().uuid(),
  scribeConsentId: z.string().uuid(),
  history: z.string(),
  examinationFindings: z.string(),
  assessment: z.string(),
  plan: z.string(),
  followUpInstructions: z.string(),
  patientSummary: z.string(),
  patientSummaryLanguage: z.enum(["en-NG", "pcm"]),
});

export async function signScribeDraft(input: z.input<typeof SignDraftSchema>) {
  const parsed = SignDraftSchema.parse(input);
  const supabase = await createClient();

  // INV-11: re-check at signing time. Consent revoked after the draft was generated blocks the write.
  const { data: consent, error: consentError } = await supabase
    .from("scribe_consents")
    .select("granted, revoked_at, encounter_note_id")
    .eq("id", parsed.scribeConsentId)
    .maybeSingle();
  if (consentError) throw new Error(consentError.message);
  if (!consent || !consent.granted || consent.revoked_at || consent.encounter_note_id !== parsed.encounterNoteId) {
    throw new Error("Scribe consent is not active for this encounter.");
  }

  // Setting status = 'finalized' is the clinician's signature; the note trigger stamps finalized_by_staff/at.
  const { error } = await supabase
    .from("clinical_encounter_notes")
    .update({
      status: "finalized",
      ai_drafted: true,
      history: parsed.history,
      examination_findings: parsed.examinationFindings,
      assessment: parsed.assessment,
      plan: parsed.plan,
      follow_up_instructions: parsed.followUpInstructions,
      scribe_consent_id: parsed.scribeConsentId,
      patient_summary: parsed.patientSummary,
      patient_summary_language: parsed.patientSummaryLanguage,
    })
    .eq("id", parsed.encounterNoteId);

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
        text: z.string().max(2000),
        speaker: z.enum(["clinician", "patient", "unknown"]),
      }),
    )
    .min(1)
    .max(2000),
  language: z.enum(["en-NG", "pcm"]),
  patientContext: z
    .object({
      age: z.number().int().min(0).max(130).optional(),
      sex: z.string().max(20).optional(),
      conditions: z.array(z.string().max(100)).max(20).optional(),
    })
    .optional(),
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
