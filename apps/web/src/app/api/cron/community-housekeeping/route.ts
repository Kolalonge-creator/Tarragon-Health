import { z } from "zod";
import { isCronAuthorised } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Daily Community housekeeping (service role, scheduled in vercel.json):
 *  1. community_purge_expired: the text of removed and deleted posts (and old appeal wording) after the retention period.
 *  2. community_images_due + community_images_mark_deleted: pictures of deleted or long-removed posts. The file is removed first and the
 *     row marked second, so a failed removal is retried tomorrow and a file that is already gone counts as removed.
 *  3. community_orphan_files: files a day old or more that no post refers to (an upload whose post was never saved, or whose answer was
 *     lost). They are unreadable by anyone, but they are removed so uploads cannot pile up.
 *  4. community_send_digests: the opt-in weekly note. The database sends at most one per member per six days, so running daily is safe.
 * None of this is needed for Community to work; it only keeps data from living longer than promised.
 */
const REMOVE_BATCH = 50;

type Remover = { remove: (paths: string[]) => Promise<{ error: { message: string } | null }> };

/** Removes a batch in one call; if that fails, one file at a time so a single bad file does not hold the rest back. Returns the paths that failed. A file already gone counts as removed. */
async function removeFiles(storage: Remover, paths: string[]): Promise<Set<string>> {
  const failed = new Set<string>();
  const bad = (e: { message: string } | null) => e !== null && !/not.?found/i.test(e.message);
  const all = await storage.remove(paths);
  if (!bad(all.error)) return failed;
  for (const path of paths) {
    const one = await storage.remove([path]);
    if (bad(one.error)) failed.add(path);
  }
  return failed;
}
const DueSchema = z.array(z.object({ id: z.string().uuid(), path: z.string() }));

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorised(authHeader)) return new Response("Not authorised", { status: 401 });

  const supabase = createServiceRoleClient();
  const result = { purged_posts: 0, images_due: 0, images_removed: 0, images_failed: 0, digests: 0, orphans_found: 0, orphans_removed: 0, orphans_failed: 0, errors: [] as string[] };

  const purge = await supabase.rpc("community_purge_expired");
  if (purge.error) result.errors.push("purge");
  else result.purged_posts = Number(purge.data ?? 0);

  const due = await supabase.rpc("community_images_due");
  const list = DueSchema.safeParse(due.data);
  if (due.error || !list.success) {
    result.errors.push("images_due");
  } else {
    result.images_due = list.data.length;
    const storage = supabase.storage.from("community-images");
    const removed: string[] = [];
    // In batches, so a long list is not removed one file per round trip. A batch that fails is counted and retried tomorrow.
    for (let i = 0; i < list.data.length; i += REMOVE_BATCH) {
      const batch = list.data.slice(i, i + REMOVE_BATCH);
      const failedPaths = await removeFiles(storage, batch.map((b) => b.path));
      result.images_failed += failedPaths.size;
      removed.push(...batch.filter((b) => !failedPaths.has(b.path)).map((b) => b.id));
    }
    if (removed.length > 0) {
      const marked = await supabase.rpc("community_images_mark_deleted", { p_ids: removed });
      if (marked.error) result.errors.push("images_mark");
      else result.images_removed = Number(marked.data ?? 0);
    }
  }

  const orphans = await supabase.rpc("community_orphan_files");
  const orphanList = z.array(z.string()).safeParse(orphans.data);
  if (orphans.error || !orphanList.success) {
    result.errors.push("orphans");
  } else {
    result.orphans_found = orphanList.data.length;
    for (let i = 0; i < orphanList.data.length; i += REMOVE_BATCH) {
      const batch = orphanList.data.slice(i, i + REMOVE_BATCH);
      const failedPaths = await removeFiles(supabase.storage.from("community-images"), batch);
      result.orphans_failed += failedPaths.size;
      result.orphans_removed += batch.length - failedPaths.size;
    }
  }

  const digests = await supabase.rpc("community_send_digests");
  if (digests.error) result.errors.push("digests");
  else result.digests = Number(digests.data ?? 0);

  // A removal that failed is a run that did not do its job (a picture stays past its promised time), so it must not look healthy.
  if (result.images_failed > 0) result.errors.push("images_remove");
  if (result.orphans_failed > 0) result.errors.push("orphans_remove");

  // Report in, so it is known this job is running. A failed report never turns a good run into a failed one.
  await supabase.rpc("community_job_heartbeat", { p_job: "housekeeping", p_ok: result.errors.length === 0 });

  return Response.json(result, { status: result.errors.length > 0 ? 500 : 200 });
}
