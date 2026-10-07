"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeRpcError } from "@/lib/clinician/written-questions";
import {
  createAmendmentSchema,
  decideReleaseSchema,
  noteRequestsSchema,
  respondCorrectionSchema,
  setProtectedSchema,
  withdrawNoteSchema,
  type NoteActionState,
  type NoteRequests,
} from "@/lib/clinician/note-requests";

const firstIssue = (issues: ReadonlyArray<{ message: string }>): string =>
  issues[0]?.message ?? "Please check the form and try again.";

/**
 * Starts a linked draft that amends a signed note. The draft is then edited and signed on the existing path; the
 * original is never changed. Returns the new draft's id so the chart can show it.
 */
export async function createNoteAmendment(
  input: { noteId: string; kind: string; reason: string },
): Promise<NoteActionState & { draftId?: string }> {
  const parsed = createAmendmentSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_note_amendment", {
    p_original: parsed.data.noteId,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: describeRpcError(error) };
  return { message: "An amendment draft was created. Edit and sign it in the notes list.", draftId: typeof data === "string" ? data : undefined };
}

/**
 * Withdraws a signed note as "entered in error". The note is never deleted or edited: staff still see it marked withdrawn,
 * the patient sees that it was withdrawn and why but none of its text, and it cannot be amended.
 */
export async function withdrawNoteAsEnteredInError(input: { noteId: string; reason: string }): Promise<NoteActionState> {
  const parsed = withdrawNoteSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_note_entered_in_error", { p_note: parsed.data.noteId, p_reason: parsed.data.reason });
  if (error) return { error: describeRpcError(error) };
  revalidatePath("/clinician/patients/[patientId]", "page");
  return { message: "The note was withdrawn as entered in error." };
}

export async function setNoteProtected(input: { noteId: string; protected: boolean }): Promise<NoteActionState> {
  const parsed = setProtectedSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_note_protected", { p_note: parsed.data.noteId, p_protected: parsed.data.protected });
  if (error) return { error: describeRpcError(error) };
  return { message: parsed.data.protected ? "Marked as protected." : "No longer marked as protected." };
}

export async function decideNoteRelease(input: { noteId: string; release: boolean; reason?: string }): Promise<NoteActionState> {
  const parsed = decideReleaseSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_note_release", {
    p_note: parsed.data.noteId,
    p_release: parsed.data.release,
    p_reason: parsed.data.reason ?? "",
  });
  if (error) return { error: describeRpcError(error) };
  return { message: parsed.data.release ? "The note is now available to the patient." : "The request was declined and the patient has been told." };
}

export async function respondNoteCorrection(input: { requestId: string; outcome: string; response: string }): Promise<NoteActionState> {
  const parsed = respondCorrectionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_note_correction", {
    p_request: parsed.data.requestId,
    p_outcome: parsed.data.outcome,
    p_response: parsed.data.response,
  });
  if (error) return { error: describeRpcError(error) };
  return { message: "Your response was sent to the patient." };
}

/** My open release and correction requests. A failure is reported as a failure, never as an empty list. */
export async function loadMyNoteRequests(): Promise<{ requests?: NoteRequests; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_note_requests");
  if (error) return { error: describeRpcError(error, "Patient requests could not be loaded.") };
  const parsed = noteRequestsSchema.safeParse(data);
  if (!parsed.success) return { error: "Patient requests could not be read. Please try again." };
  return { requests: parsed.data };
}
