"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  describeAvsError,
  noteIdSchema,
  reviewSchema,
  saveDraftSchema,
  summaryIdSchema,
  withdrawSummarySchema,
  type VisitSummaryReview,
} from "@/lib/visit-summary/schemas";
import { avsCopyProblems } from "@tarragon/i18n";

/**
 * Clinician side of the after-visit summary (AVS). Every function here is a thin, validated call to a database function that
 * does the real checking (doctor only, signed note only, copy rules, signature stamped by the database).
 */
export interface AvsActionState {
  error?: string;
  message?: string;
  problems?: string[];
}

const GENERIC = "That did not save. Check your connection and try again.";
const firstIssue = (issues: ReadonlyArray<{ message: string }>): string => issues[0]?.message ?? "Please check the form and try again.";

/** The review read is audited by the database (INV-10). A failure is reported as a failure, never as "no summary". */
export async function loadVisitSummaryReview(input: { noteId: string }): Promise<{ review?: VisitSummaryReview; error?: string }> {
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_visit_summary_for_review", { p_note: parsed.data.noteId });
  if (error) return { error: describeAvsError(error, GENERIC) };
  const review = reviewSchema.safeParse(data);
  if (!review.success) return { error: GENERIC };
  return { review: review.data };
}

/** Builds (or reopens) the draft from the signed note and the signed orders of the same visit. No model is involved. */
export async function startVisitSummaryDraft(input: { noteId: string }): Promise<AvsActionState> {
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assemble_visit_summary", { p_note: parsed.data.noteId });
  if (error) return { error: describeAvsError(error, GENERIC) };
  revalidatePath("/clinician/patients/[patientId]", "page");
  return { message: "draft" };
}

export async function saveVisitSummaryDraft(input: {
  summaryId: string;
  text: string;
  items: ReadonlyArray<{ id?: string; kind: string; params?: Record<string, string | number | boolean | null>; customText?: string; dueOn?: string }>;
}): Promise<AvsActionState> {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const items = parsed.data.items.map((i) => ({
    ...(i.id ? { id: i.id } : {}),
    kind: i.kind,
    params: i.params ?? {},
    custom_text: i.customText ?? "",
    due_on: i.dueOn ?? "",
  }));
  const { error } = await supabase.rpc("update_visit_summary_draft", {
    p_summary: parsed.data.summaryId,
    p_text: parsed.data.text,
    p_items: items,
  });
  if (error) return { error: describeAvsError(error, GENERIC) };
  return { message: "saved" };
}

/** Approving is the clinician's signature. The text is checked here first so the doctor sees the same answer the database gives. */
export async function approveVisitSummary(input: { summaryId: string; text: string }): Promise<AvsActionState> {
  const parsed = summaryIdSchema.safeParse({ summaryId: input.summaryId });
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const early = avsCopyProblems(input.text);
  if (early.length > 0) return { error: describeAvsError({ message: "visit_summary_copy_rules" }, GENERIC), problems: early };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_visit_summary", { p_summary: parsed.data.summaryId });
  if (error) {
    const detail = (error as { details?: string }).details;
    return { error: describeAvsError(error, GENERIC), problems: detail ? detail.split(",") : undefined };
  }
  revalidatePath("/clinician/patients/[patientId]", "page");
  return { message: "approved" };
}

export async function withdrawVisitSummary(input: { summaryId: string; reason: string }): Promise<AvsActionState> {
  const parsed = withdrawSummarySchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_visit_summary", { p_summary: parsed.data.summaryId, p_reason: parsed.data.reason });
  if (error) return { error: describeAvsError(error, GENERIC) };
  revalidatePath("/clinician/patients/[patientId]", "page");
  return { message: "withdrawn" };
}
