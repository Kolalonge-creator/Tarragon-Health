import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rpcParsed, rpcVoid } from "@/lib/credentialing/rpc";

/**
 * Nightly purge of clinician credential documents past their retention (S15, OQ-108): documents of an offboarded
 * clinician after the retention date, and documents of a rejected application after the rejected-application period.
 *
 * The database decides what is due and does nothing at all while the config rule `document_purge_enabled` is false, so
 * this route is safe to leave scheduled. Per document the stored file is removed first and the row (with an audit
 * entry) second: if the file cannot be removed the row stays and tomorrow's run tries again, and a file that is
 * already gone counts as removed, so a failed second step is also repaired by the next run.
 */
const DueSchema = z.array(z.object({ document_id: z.string().uuid(), storage_path: z.string(), reason: z.string() }));

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  let due: z.infer<typeof DueSchema>;
  try {
    due = await rpcParsed(supabase, "credential_documents_due_for_purge", { p_limit: 100 }, DueSchema);
  } catch {
    return Response.json({ error: "could not list documents due for purge" }, { status: 500 });
  }
  if (due.length === 0) return Response.json({ due: 0, purged: 0, failed: 0 });

  const storage = supabase.storage.from("clinician-documents");
  let purged = 0;
  let failed = 0;
  for (const doc of due) {
    const { error: removeError } = await storage.remove([doc.storage_path]);
    if (removeError && !/not.?found/i.test(removeError.message)) {
      failed += 1;
      continue;
    }
    try {
      await rpcVoid(supabase, "purge_credential_document", { p_document: doc.document_id });
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return Response.json({ due: due.length, purged, failed });
}
