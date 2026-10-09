import { z } from "zod";
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
const DueSchema = z.array(z.object({ id: z.string().uuid(), path: z.string() }));

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Not authorised", { status: 401 });

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
    for (const item of list.data) {
      const { error } = await storage.remove([item.path]);
      if (error && !/not.?found/i.test(error.message)) result.images_failed += 1;
      else removed.push(item.id);
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
    for (const path of orphanList.data) {
      const { error } = await supabase.storage.from("community-images").remove([path]);
      if (error && !/not.?found/i.test(error.message)) result.orphans_failed += 1;
      else result.orphans_removed += 1;
    }
  }

  const digests = await supabase.rpc("community_send_digests");
  if (digests.error) result.errors.push("digests");
  else result.digests = Number(digests.data ?? 0);

  return Response.json(result, { status: result.errors.length > 0 ? 500 : 200 });
}
