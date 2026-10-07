import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signCareMessageAttachmentPath } from "@/lib/care-messages/attachments";

const attachmentIdSchema = z.string().uuid();

/**
 * Redirects to a short-lived signed URL for a care-message attachment
 * (77.10). Cookie-session auth. The caller is authorised BEFORE the service
 * role signs anything:
 *  - the patient or org staff go through open_care_attachment_audited, which
 *    authorises them and (for staff) writes the audit row, then returns the
 *    storage path;
 *  - a supporter or break-glass reader gets SQLSTATE 42501 from it and falls
 *    back to reading the row through their own RLS-scoped session
 *    (care_message_attachments_select still admits them).
 * Anything neither path finds is a 404, so a foreign attachmentId never
 * reveals that the file exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId: rawId } = await params;
  const idResult = attachmentIdSchema.safeParse(rawId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!idResult.success) return new Response("Not found", { status: 404 });
  const attachmentId = idResult.data;

  let filePath: string | null = null;
  const { data: auditedPath, error: auditedError } = await supabase.rpc("open_care_attachment_audited", {
    p_attachment: attachmentId,
  });
  if (!auditedError) {
    filePath = auditedPath;
  } else if (auditedError.code === "42501") {
    const { data: attachment } = await supabase
      .from("care_message_attachments")
      .select("file_path")
      .eq("id", attachmentId)
      .maybeSingle();
    filePath = attachment?.file_path ?? null;
  } else if (auditedError.code === "P0002") {
    return new Response("Not found", { status: 404 });
  } else {
    return new Response("Could not open file", { status: 500 });
  }
  if (!filePath) return new Response("Not found", { status: 404 });

  const signedUrl = await signCareMessageAttachmentPath(filePath);
  if (!signedUrl) return new Response("Could not open file", { status: 500 });

  return Response.redirect(signedUrl, 302);
}
