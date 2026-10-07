"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DOCUMENT_CAPTURE_GUARD, runDocumentCapture } from "./run";
import { fieldDecisionsSchema, type FieldDecision } from "./suggestions";

export type CaptureActionResult = { error?: string; success?: boolean; message?: string; status?: string };

const documentIdSchema = z.string().uuid();

/**
 * Asks for a just-uploaded photo to be read into suggestions.
 *
 * The patient must own the document (their own RLS select is the gate) and
 * the capture guard must be open for them: a closed guard means the photo is
 * kept as a plain upload and no model is ever called.
 */
export async function requestDocumentReadingAction(documentId: string): Promise<CaptureActionResult> {
  const id = documentIdSchema.safeParse(documentId);
  if (!id.success) return { error: "That photo could not be found." };
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("patient_documents")
    .select("id, patient_id, ocr_state")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc || doc.patient_id !== user.id) return { error: "That photo could not be found." };
  if (doc.ocr_state !== "pending") return { error: "That photo is not waiting to be read." };

  const { data: open } = await supabase.rpc("go_live_guard_is_open", { p_key: DOCUMENT_CAPTURE_GUARD });
  if (open !== true) {
    // Closed: keep the photo, ask for nothing from a model. The patient types the details in by hand.
    return { success: true, status: "closed", message: "Reading from photos is not open yet. Your photo is saved." };
  }

  const outcome = await runDocumentCapture(createServiceRoleClient(), id.data);
  revalidatePath("/patient/documents");
  if (outcome.status === "failed") return { error: outcome.message, status: outcome.status };
  return { success: true, status: outcome.status, message: outcome.message };
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
