import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * S59b (spec 12.7, OQ-S59-07): the retention job for skin photos. Runs DAILY (never sub-daily: Vercel cron limits). It removes the
 * stored file for every photo whose `retention_until` has passed (or that the patient withdrew), and only THEN marks the record
 * purged. Deleting a storage row from SQL would leave the file behind on hosted storage, which is why this goes through the storage API.
 *
 * Idempotent: the due list excludes purged rows, removing a file that is already gone is not an error, and a photo whose file was
 * removed but whose record could not be marked is simply listed again next run.
 * Loud: any failure is reported to Sentry per photo, the run answers 500 so the cron shows red, and a failed removal never marks the
 * record purged (so the photo stays on the due list and is retried).
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const service = createServiceRoleClient();
  const { data: due, error: listError } = await service.rpc("skin_photos_due_for_purge");
  if (listError) {
    Sentry.captureException(new Error(`skin photo purge: could not list due photos: ${listError.message}`));
    return Response.json({ error: "could not list due photos" }, { status: 500 });
  }

  let removed = 0;
  let failed = 0;
  for (const photo of due ?? []) {
    try {
      const { error: rmError } = await service.storage.from("skin-photos").remove([photo.storage_path]);
      if (rmError) throw new Error(`storage remove failed: ${rmError.message}`);
      const { error: markError } = await service.rpc("mark_skin_photo_purged", { p_photo: photo.id });
      if (markError) throw new Error(`mark purged failed: ${markError.message}`);
      removed += 1;
    } catch (e) {
      failed += 1;
      // ids only: a photo path carries the patient's id folder, never put it in an error message that leaves the platform
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: { photoId: photo.id, where: "skin-photo-purge" } });
    }
  }

  return Response.json({ due: (due ?? []).length, removed, failed }, { status: failed > 0 ? 500 : 200 });
}
