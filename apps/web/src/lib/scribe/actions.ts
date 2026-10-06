"use server";

import { createClient } from "@/lib/supabase/server";
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

  const { data, error } = await supabase
    .from("scribe_consents")
    .insert({
      patient_id: parsed.patientId,
      encounter_note_id: parsed.encounterNoteId ?? null,
      granted: parsed.granted,
      language: parsed.language,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function revokeScribeConsent(consentId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("scribe_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentId);

  if (error) throw new Error(error.message);
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

  const { error } = await supabase
    .from("clinical_encounter_notes")
    .update({
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

export async function callScribeDraft(input: {
  scribeConsentId: string;
  encounterNoteId: string;
  segments: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
    speaker: "clinician" | "patient" | "unknown";
  }>;
  language: "en-NG" | "pcm";
  patientContext?: {
    age?: number;
    sex?: string;
    conditions?: readonly string[];
  };
}) {
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
