import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Mint short-lived signed URLs for a batch of private-bucket storage paths
 * in a single Storage API call, keyed by path.
 *
 * Every list of caller-uploaded documents on this platform (result
 * documents, ECG reports, vaccination certificates, ...) used to mint each
 * row's signed URL with its own createSignedUrl round trip — a real N+1: a
 * patient/org with 20 documents fired 20 separate Storage requests on every
 * page load. This is the one shared batching implementation for that
 * pattern (previously duplicated near-identically across
 * lib/lab-results/documents.ts, lib/ecg-reports/documents.ts, and
 * clinician/vaccinations/page.tsx) — one createSignedUrls call regardless
 * of row count.
 *
 * The caller must already have read the owning row through their own
 * RLS-scoped session before asking for a URL — this uses the service-role
 * client because org staff have no direct storage-object read policy on
 * these buckets (only the uploader's own uid-folder policy exists), so the
 * row-level RLS on the owning table is the real authorisation gate, never
 * this function. Never returns a public URL.
 *
 * A per-object signing failure inside an otherwise-successful batch still
 * comes back as that one path's own null entry — expected, and the
 * caller-visible "file could not be loaded" state already handles it.
 * What batching trades away is failure *isolation*: previously N
 * independent requests meant a bad request cost one document; now a
 * request-level failure (an expired service-role token, a transient
 * Storage 5xx, a dropped connection) silently zeroes out every path in the
 * batch at once. Logging that error here is what keeps a genuine outage
 * from rendering identically to "nothing to show" — an empty verification
 * queue or missing result reads as "already handled", not as a bug.
 */
export async function signStoragePaths(
  bucket: string,
  paths: string[],
  ttlSeconds: number,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (paths.length === 0) return map;
  const service = createServiceRoleClient();
  const { data, error } = await service.storage.from(bucket).createSignedUrls(paths, ttlSeconds);
  if (error) {
    console.error(
      `Failed to batch-sign ${paths.length} storage URL(s) in bucket "${bucket}"`,
      error,
    );
  }
  for (const entry of data ?? []) {
    map.set(entry.path ?? "", entry.signedUrl ?? null);
  }
  return map;
}
