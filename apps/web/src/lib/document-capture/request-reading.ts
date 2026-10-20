import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DOCUMENT_CAPTURE_GUARD, runDocumentCapture } from "./run";

export type CaptureActionResult = { error?: string; success?: boolean; message?: string; status?: string };

/**
 * Asks for a just-uploaded photo to be read into suggestions. One implementation for the web server action and the phone's route, so the rules
 * cannot differ between them.
 *
 * `supabase` is the CALLER's own RLS client (a cookie session on the web, the bearer token on the phone): the patient must own the document and
 * the capture guard must be open for them. A closed guard means the photo is kept as a plain upload and no model is ever called.
 */
export async function requestReadingFor(supabase: SupabaseClient<Database>, userId: string, documentId: string): Promise<CaptureActionResult> {
  const { data: doc } = await supabase.from("patient_documents").select("id, patient_id, ocr_state").eq("id", documentId).maybeSingle();
  if (!doc || doc.patient_id !== userId) return { error: "That photo could not be found." };
  if (doc.ocr_state !== "pending") return { error: "That photo is not waiting to be read.", status: "not_pending" };

  const { data: open } = await supabase.rpc("go_live_guard_is_open", { p_key: DOCUMENT_CAPTURE_GUARD });
  if (open !== true) {
    // Closed: keep the photo, ask for nothing from a model. Mark the reading failed (it needs no open guard) so the photo
    // does not wait forever; the patient types any details in by hand.
    const { error } = await createServiceRoleClient().rpc("record_document_suggestion", {
      p_document: documentId,
      p_ocr_text: "",
      p_extracted: {},
      p_model: "none",
      p_failed: true,
    });
    // If the photo could not be marked, say so: "closed" would be a false answer for a photo that still waits and would keep offering Read now.
    if (error) return { error: "That could not be saved just now. Please try again.", status: "failed" };
    return { success: true, status: "closed", message: "Reading from photos is not open yet. Your photo is saved." };
  }

  const outcome = await runDocumentCapture(createServiceRoleClient(), documentId);
  if (outcome.status === "failed") return { error: outcome.message, status: outcome.status };
  return { success: true, status: outcome.status, message: outcome.message };
}
