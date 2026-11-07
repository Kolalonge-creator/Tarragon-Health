import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type LooseRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Shown when a document is held for its malware scan (the scanner was unavailable when it arrived). */
const HELD_MESSAGE =
  "This document is waiting for its safety check and cannot be opened yet. It is usually cleared within a day; please try again later.";

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

  // open_clinician_document refuses a document still waiting for its malware scan (P0001 'document_held'), but only after it
  // has confirmed the caller may see it, so saying "held" leaks nothing to a stranger.
  const { data: opened, error: openError } = await (supabase as unknown as LooseRpc).rpc("open_clinician_document", {
    p_document: documentId,
  });
  if (openError?.code === "P0001" && openError.message.startsWith("document_held")) {
    return new Response(HELD_MESSAGE, { status: 423, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const parsed = z.string().safeParse(opened);
  if (openError || !parsed.success) return new Response("Not found", { status: 404 });
  const path = parsed.data;

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
