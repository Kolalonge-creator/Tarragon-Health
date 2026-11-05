import { isCronAuthorised } from "@/lib/cron-auth";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Security finding S5 (2026-11-05): the storage side of a purge. public.purge_test_account deletes an account's rows and queues
 * its stored files in private.storage_deletion_queue (migration 20261105164215); SQL cannot remove a stored file (deleting a
 * storage.objects row is refused and would leave the bytes behind), so this daily job removes each queued file through the
 * Storage API with the service role, and only then marks the queue row done.
 *
 * Idempotent: removing a file that is already gone is not an error, and done rows never come back. A path that a record points at
 * again is never offered by storage_deletions_due. Loud: a failed removal records its error on the row (it stays due and is
 * retried next run), is reported to Sentry by queue id only (a path carries a person's id folder), and the run answers 500.
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorised(request.headers.get("authorization"))) {
    return new Response("Not authorised", { status: 401 });
  }

  const service = createServiceRoleClient();
  const { data: due, error: listError } = await service.rpc("storage_deletions_due", { p_limit: 500 });
  if (listError) {
    Sentry.captureException(new Error(`storage deletion sweep: could not list due files: ${listError.message}`));
    return Response.json({ error: "could not list due files" }, { status: 500 });
  }

  let removed = 0;
  let failed = 0;
  for (const item of due ?? []) {
    const { error: rmError } = await service.storage.from(item.bucket_id).remove([item.name]);
    if (rmError) {
      failed += 1;
      await service.rpc("mark_storage_deletion_done", { p_id: item.id, p_error: rmError.message });
      Sentry.captureException(new Error(`storage deletion sweep: remove failed: ${rmError.message}`), {
        extra: { queueId: item.id, bucket: item.bucket_id, where: "storage-deletion-sweep" },
      });
      continue;
    }
    const { error: markError } = await service.rpc("mark_storage_deletion_done", { p_id: item.id });
    if (markError) {
      failed += 1;
      Sentry.captureException(new Error(`storage deletion sweep: mark done failed: ${markError.message}`), {
        extra: { queueId: item.id, where: "storage-deletion-sweep" },
      });
      continue;
    }
    removed += 1;
  }

  return Response.json({ due: (due ?? []).length, removed, failed }, { status: failed > 0 ? 500 : 200 });
}
