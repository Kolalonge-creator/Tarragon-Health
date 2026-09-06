import { createClient } from "@/lib/supabase/server";
import { signCareMessageAttachmentPath } from "@/lib/care-messages/attachments";

/**
 * Redirects to a short-lived signed URL for a care-message attachment
 * (77.10). Cookie-session auth, and the row read runs through the caller's
 * own RLS-scoped session — care_message_attachments_select only admits the
 * patient, org staff, or a consented sponsor, so a foreign attachmentId
 * simply returns nothing and this 404s rather than leaking that the file
 * exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: attachment } = await supabase
    .from("care_message_attachments")
    .select("file_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment) return new Response("Not found", { status: 404 });

  const signedUrl = await signCareMessageAttachmentPath(attachment.file_path);
  if (!signedUrl) return new Response("Could not open file", { status: 500 });

  return Response.redirect(signedUrl, 302);
}
