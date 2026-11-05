import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { runClientUploadChecks } from "./verify-stored-upload";

/**
 * The read-side gate for files clients write straight to Storage (security audit 2026-11-05, M-4/L-4). The verifier normally
 * checks a file within seconds of upload, but until it has, nothing on the server hands the file out: no signed URL for the
 * care team, no download for an AI reader. A file still waiting is checked inline right here first; one that is still not
 * cleared afterwards (refused, or the check keeps failing) is withheld, and the caller shows its existing "file could not be
 * loaded" state.
 *
 * Files with no check row (written before the check existed, or by the server itself) are not withheld: they are either
 * server uploads that already went through prepareUpload, or legacy files outside this mechanism.
 */

type Service = SupabaseClient<Database>;

/** The buckets clients write to directly; mirrors private.is_client_upload_checked_bucket in the migration. */
export const CLIENT_UPLOAD_BUCKETS: ReadonlySet<string> = new Set([
  "vaccination-certificates",
  "meal-photos",
  "patient-documents",
  "care-message-attachments",
  "second-opinion-documents",
  "child-card-photos",
  "async-consult-attachments",
  "clinical-staff-photos",
  "patient-avatars",
]);

const CLEARED = new Set(["clean", "cleaned", "gone"]);

async function statuses(service: Service, bucket: string, paths: string[]): Promise<Map<string, { status: string; owner: string }> | null> {
  const { data, error } = await service.rpc("client_upload_check_statuses", { p_bucket: bucket, p_names: paths });
  if (error) return null;
  return new Map((data ?? []).map((r) => [r.object_name, { status: r.status, owner: r.owner_id }]));
}

/**
 * The subset of `paths` that must not be handed out yet. When the status lookup itself fails, every path is withheld: a
 * gate that opens on error is no gate (the caller's "could not be loaded" state is the honest answer).
 */
export async function blockedUncheckedPaths(service: Service, bucket: string, paths: string[]): Promise<Set<string>> {
  if (!CLIENT_UPLOAD_BUCKETS.has(bucket) || paths.length === 0) return new Set();
  let found = await statuses(service, bucket, paths);
  if (!found) return new Set(paths);

  const waiting = [...found].filter(([, v]) => v.status === "pending" || v.status === "checking" || v.status === "error");
  if (waiting.length > 0) {
    for (const [name, v] of waiting) {
      // Claims only a pending row (or a stale checking/error one), so a check already running elsewhere is not doubled.
      await runClientUploadChecks(service, { limit: 1, only: { bucket, name, ownerId: v.owner } });
    }
    found = await statuses(service, bucket, paths);
    if (!found) return new Set(paths);
  }
  return new Set([...found].filter(([, v]) => !CLEARED.has(v.status)).map(([name]) => name));
}

/** Single-path form: true when the file may be handed out. */
export async function isClearedForReading(service: Service, bucket: string, path: string): Promise<boolean> {
  return !(await blockedUncheckedPaths(service, bucket, [path])).has(path);
}
