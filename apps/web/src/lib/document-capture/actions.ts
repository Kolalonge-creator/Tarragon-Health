"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requestReadingFor, type CaptureActionResult } from "./request-reading";
import { fieldDecisionsSchema, type FieldDecision } from "./suggestions";

export type { CaptureActionResult };

const documentIdSchema = z.string().uuid();

/** Asks for a just-uploaded photo to be read into suggestions (the rules live in request-reading.ts, shared with the phone's route). */
export async function requestDocumentReadingAction(documentId: string): Promise<CaptureActionResult> {
  const id = documentIdSchema.safeParse(documentId);
  if (!id.success) return { error: "That photo could not be found." };
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const result = await requestReadingFor(supabase, user.id, id.data);
  revalidatePath("/patient/documents");
  return result;
}

/** The patient confirms, field by field. Only accepted fields are kept; the rest are dropped by the database. */
export async function confirmDocumentFieldsAction(documentId: string, decisions: FieldDecision[]): Promise<CaptureActionResult> {
  const id = documentIdSchema.safeParse(documentId);
  const parsed = fieldDecisionsSchema.safeParse(decisions);
  if (!id.success || !parsed.success) return { error: "That could not be saved." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_document_extraction", { p_document: id.data, p_fields: parsed.data });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/patient/documents");
  const kept = (data as { kept?: number } | null)?.kept ?? 0;
  return { success: true, message: `Kept ${kept} detail${kept === 1 ? "" : "s"}.` };
}

/** The patient rejects the whole reading. The photo stays; the text and every value go. */
export async function rejectDocumentReadingAction(documentId: string): Promise<CaptureActionResult> {
  const id = documentIdSchema.safeParse(documentId);
  if (!id.success) return { error: "That photo could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_document_extraction", { p_document: id.data });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/patient/documents");
  return { success: true, message: "Nothing from that reading was kept. Your photo is saved." };
}

function friendly(message: string): string {
  if (message.includes("confirm at least one")) return "Confirm at least one detail, or reject the reading.";
  if (message.includes("nothing waiting")) return "There is nothing waiting for you to confirm.";
  return "That could not be saved. Please try again.";
}
