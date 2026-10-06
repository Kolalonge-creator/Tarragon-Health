import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rpcParsed } from "@/lib/credentialing/rpc";

/**
 * Serves one credential document to its owner or to a reviewer (S15). There is no signed link to share: the bytes
 * come through this route, which asks the database first (`open_clinician_document` checks the caller and writes an
 * access-log row) and only then reads the private bucket with the service role. A person who may not see the
 * document gets the same 404 as one that does not exist, so a guessed id learns nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }): Promise<Response> {
  const { documentId } = await params;
  if (!z.uuid().safeParse(documentId).success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  let path: string;
  try {
    path = await rpcParsed(supabase, "open_clinician_document", { p_document: documentId }, z.string());
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const { data, error } = await createServiceRoleClient().storage.from("clinician-documents").download(path);
  if (error || !data) return new Response("Not found", { status: 404 });

  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Content-Disposition": 'inline; filename="credential-document"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
