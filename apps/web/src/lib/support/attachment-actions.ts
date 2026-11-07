"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { screenUpload } from "@/lib/upload-scan/screen";

/**
 * Support ticket attachments (SUP-2, migration 20261107022505). The caller's own RLS decides whether they may touch the
 * ticket; only then does the server scan the bytes (T2-08), store them in the private bucket with the service role and
 * record the row. Links are signed for one minute and only after this table's RLS has allowed the row, so a restricted
 * or held file never gets a link.
 */

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
};
const BUCKET = "support-attachments";

const uploadSchema = z.object({
  ticketId: z.string().uuid(),
  internal: z.boolean(),
});

export type AttachmentResult = { ok: true } | { ok: false; error: string };

export async function uploadSupportAttachment(formData: FormData): Promise<AttachmentResult> {
  const parsed = uploadSchema.safeParse({
    ticketId: formData.get("ticket_id"),
    internal: formData.get("internal") === "true",
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof Blob)) return { ok: false, error: "Choose a file to attach." };
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Files must be under 10 MB." };
  const ext = MIME_EXT[file.type];
  if (!ext) return { ok: false, error: "Attach a photo (PNG, JPEG, WebP), a PDF or a text file." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  // RLS: the patient sees their own ticket, org staff see their organisation's. Anyone else gets no row.
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, organisation_id, patient_id, status")
    .eq("id", parsed.data.ticketId)
    .maybeSingle();
  if (!ticket) return { ok: false, error: "That ticket was not found." };
  if (ticket.status === "closed") return { ok: false, error: "This ticket is closed. Start a new one if the problem continues." };

  const isPatient = ticket.patient_id === user.id;
  if (isPatient && parsed.data.internal) return { ok: false, error: "Only staff can add internal files." };

  const service = createServiceRoleClient();
  const screened = await screenUpload(service, file, { patientId: ticket.patient_id, uploadedBy: user.id });
  if (!screened.ok) return { ok: false, error: screened.error };

  const path = `${ticket.organisation_id}/${ticket.id}/${randomUUID()}.${ext}`;
  const { error: storeError } = await service.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (storeError) return { ok: false, error: "We could not save this file just now. Please try again." };

  const rawName = file instanceof File && file.name ? file.name : `attachment.${ext}`;
  const { error: rowError } = await service.from("support_ticket_attachments").insert({
    organisation_id: ticket.organisation_id,
    ticket_id: ticket.id,
    storage_path: path,
    file_name: rawName.replace(/[^\w.\- ]+/g, "_").slice(0, 200),
    mime_type: file.type,
    size_bytes: file.size,
    content_sha256: screened.sha256,
    scan_status: screened.verdict === "clean" ? "clean" : screened.verdict === "held" ? "pending_scan" : "unscanned",
    uploaded_by: user.id,
    uploader_role: isPatient ? "patient" : "staff",
    is_internal: !isPatient && parsed.data.internal,
  });
  if (rowError) {
    await service.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "We could not save this file just now. Please try again." };
  }
  return { ok: true };
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

export async function getSupportAttachmentLink(attachmentId: string): Promise<LinkResult> {
  if (!z.string().uuid().safeParse(attachmentId).success) return { ok: false, error: "That file was not found." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("support_ticket_attachments")
    .select("id, storage_path, scan_status")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That file was not found." };
  if (row.scan_status === "pending_scan") return { ok: false, error: "This file is waiting for its safety check. Try again later." };
  const { data, error } = await createServiceRoleClient().storage.from(BUCKET).createSignedUrl(row.storage_path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The file could not be opened just now." };
  return { ok: true, url: data.signedUrl };
}
