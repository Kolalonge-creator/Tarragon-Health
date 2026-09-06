import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const CARE_MESSAGE_ATTACHMENT_BUCKET = "care-message-attachments";

/**
 * Mint a short-lived signed URL for a care-message attachment's storage
 * object. Same reasoning as lib/lab-results/documents.ts'
 * signResultDocumentPath: the bucket's own storage policies only let the
 * uploader read their own uid folder back, so a patient's attachment is
 * unreadable to org staff (and a clinician's own upload is unreadable to
 * the patient) without this — the row-level RLS on
 * care_message_attachments is the real authorisation gate, so the CALLER
 * must already have read the row through their own RLS-scoped session
 * before asking for a URL. Never returns a public URL.
 */
export async function signCareMessageAttachmentPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage
    .from(CARE_MESSAGE_ATTACHMENT_BUCKET)
    .createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
