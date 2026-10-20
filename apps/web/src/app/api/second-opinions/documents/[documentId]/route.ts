import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SECOND_OPINION_DOCUMENT_BUCKET, secondOpinionReadSchema } from "@/lib/validation/second-opinion";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, private" } as const;
const paramsSchema = z.object({ documentId: z.string().uuid(), request: z.string().uuid() });

/**
 * Opens one outside document a patient attached to a second-opinion request.
 *
 * The document table is closed to every signed-in role and the bucket has no staff policy, so authority is proven first, as the
 * caller, by the audited read of the request (active non-coordinator doctor of the patient's organisation, request still open or
 * answered by this doctor); that read also writes the audit row. Only then, and only for a document that read listed for this
 * request, is the service role used to sign a 60 second URL. A foreign or guessed id returns 404, never a hint that it exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }): Promise<Response> {
  const { documentId } = await params;
  const ids = paramsSchema.safeParse({ documentId, request: new URL(request.url).searchParams.get("request") });
  if (!ids.success) return new Response("Not found", { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401, headers: NO_STORE });

  const read = await supabase.rpc("read_second_opinion_audited", { p_request: ids.data.request });
  if (read.error) return new Response("Not found", { status: 404, headers: NO_STORE });
  const parsed = secondOpinionReadSchema.safeParse(read.data);
  if (!parsed.success || !parsed.data.documents.some((d) => d.id === ids.data.documentId)) {
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }

  const service = createServiceRoleClient();
  const { data: row } = await service
    .from("second_opinion_documents")
    .select("storage_path")
    .eq("id", ids.data.documentId)
    .eq("request_id", ids.data.request)
    .maybeSingle();
  if (!row) return new Response("Not found", { status: 404, headers: NO_STORE });

  const { data: signed } = await service.storage.from(SECOND_OPINION_DOCUMENT_BUCKET).createSignedUrl(row.storage_path, 60);
  if (!signed?.signedUrl) return new Response("Could not open file", { status: 500, headers: NO_STORE });

  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: signed.signedUrl } });
}
