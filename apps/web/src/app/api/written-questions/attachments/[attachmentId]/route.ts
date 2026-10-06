import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  WRITTEN_QUESTION_PHOTO_READ_REASON,
  attachmentParamsSchema,
  writtenQuestionSchema,
} from "@/lib/clinician/written-questions";

export const dynamic = "force-dynamic";

const BUCKET = "async-consult-attachments";
const NO_STORE = { "Cache-Control": "no-store, private" } as const;

/**
 * Opens one photo on a written question (S22). The photo table is closed to every signed-in role, so authority is
 * proven first, as the caller, by the audited read of the question: it refuses unless the clinician holds a live
 * claim (INV-12) and it writes the audit row (INV-10). Only after that, and only for a photo the audited read listed
 * for this question, is the service role used to sign a 60 second URL. A foreign or guessed id returns 404, never a
 * hint that the file exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }): Promise<Response> {
  const { attachmentId } = await params;
  const consult = new URL(request.url).searchParams.get("consult");
  const ids = attachmentParamsSchema.safeParse({ attachmentId, consult });
  if (!ids.success) return new Response("Not found", { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401, headers: NO_STORE });

  const read = await supabase.rpc("read_written_question_audited", {
    p_consult: ids.data.consult,
    p_reason: WRITTEN_QUESTION_PHOTO_READ_REASON,
  });
  if (read.error) return new Response("Not found", { status: 404, headers: NO_STORE });
  const question = writtenQuestionSchema.safeParse(read.data);
  if (!question.success || !question.data.photos.some((p) => p.id === ids.data.attachmentId)) {
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }

  const service = createServiceRoleClient();
  const { data: row } = await service
    .from("async_consult_attachments")
    .select("storage_path")
    .eq("id", ids.data.attachmentId)
    .eq("consult_id", ids.data.consult)
    .maybeSingle();
  if (!row) return new Response("Not found", { status: 404, headers: NO_STORE });

  const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(row.storage_path, 60);
  if (!signed?.signedUrl) return new Response("Could not open file", { status: 500, headers: NO_STORE });

  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: signed.signedUrl } });
}
