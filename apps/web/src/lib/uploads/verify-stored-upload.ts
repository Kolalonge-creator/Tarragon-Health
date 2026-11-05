import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { detectResultDocType } from "@/lib/validation/result-doc-signature";
import { prepareUpload } from "./prepare-upload";

/**
 * The server check for files a browser or the phone app wrote straight to Storage with the user's own token (security audit
 * 2026-11-05, M-4/L-4, follow-up to PR #1749). The storage.objects trigger queues each such object in
 * private.client_upload_checks (migration 20261105120005_client_upload_checks.sql); this claims them and runs the exact same
 * prepareUpload() a server upload goes through:
 *
 * - bytes are not what the file claims (a renamed executable or HTML page): the file is moved to the private upload-quarantine
 *   bucket and removed from where the client put it ('quarantined'). The row that pointed at it now points at nothing, which
 *   the screens already show as a missing file; nothing that was refused is ever served.
 * - a JPEG, PNG or WEBP photo with location, device or time metadata: the clean copy is written back in place ('cleaned').
 * - anything else that passes (a PDF, a HEIC photo, a photo with nothing to remove): left alone ('clean').
 *
 * Before writing a clean copy back or removing a refused file, the row must still be 'checking': if the user replaced the file
 * meanwhile, the trigger has put it back to 'pending', and the verifier leaves the new file alone (it is checked next run).
 *
 * Publicly served buckets refuse a photo that cannot be cleaned (prepareUpload's requireClean), as server uploads do.
 * Quarantines and repeated failures are reported to Sentry, so neither is only a log line. Not a malware scan; that is a
 * separate founder decision.
 */

type Service = SupabaseClient<Database>;

export const QUARANTINE_BUCKET = "upload-quarantine";
const PUBLIC_BUCKETS = new Set(["patient-avatars", "clinical-staff-photos"]);

export type UploadCheckOutcome = "clean" | "cleaned" | "quarantined" | "gone" | "error";

export type ClaimedUpload = { bucket_id: string; object_name: string; mimetype: string | null; owner_id: string };

/** True while nobody has replaced the object since it was claimed (the trigger resets a replaced file to 'pending'). */
async function stillCurrent(service: Service, item: ClaimedUpload): Promise<boolean> {
  const { data, error } = await service.rpc("client_upload_check_outcome", {
    p_bucket: item.bucket_id,
    p_name: item.object_name,
    p_owner: item.owner_id,
  });
  return !error && data === "checking";
}

export async function verifyStoredUpload(service: Service, item: ClaimedUpload): Promise<{ outcome: UploadCheckOutcome; detail?: string }> {
  const { bucket_id: bucket, object_name: name } = item;
  const download = await service.storage.from(bucket).download(name);
  if (download.error || !download.data) {
    // Removed or moved before the check ran: nothing left to serve. A move queues the new name separately.
    const missing = /not.?found|404/i.test(download.error?.message ?? "");
    return missing ? { outcome: "gone" } : { outcome: "error", detail: download.error?.message ?? "download failed" };
  }

  const original = new Uint8Array(await download.data.arrayBuffer());
  // With no declared type at all, judge by the bytes rather than refusing a real file for a missing label.
  const declared = item.mimetype || download.data.type || detectResultDocType(original.subarray(0, 1024)) || "application/octet-stream";
  const file = new File([original], name.split("/").pop() ?? "upload", { type: declared });
  const prepared = await prepareUpload(file, { requireClean: PUBLIC_BUCKETS.has(bucket) });

  if (!prepared.ok) {
    // Stored as opaque bytes so nothing in the quarantine bucket can ever render in a browser.
    const kept = await service.storage
      .from(QUARANTINE_BUCKET)
      .upload(`${bucket}/${name}`, original, { contentType: "application/octet-stream", upsert: true });
    if (kept.error) return { outcome: "error", detail: `quarantine copy failed: ${kept.error.message}` };
    if (!(await stillCurrent(service, item))) return { outcome: "error", detail: "replaced while being checked; the new file is checked next" };
    const removed = await service.storage.from(bucket).remove([name]);
    if (removed.error) return { outcome: "error", detail: `remove failed: ${removed.error.message}` };
    return { outcome: "quarantined", detail: `${declared}: ${prepared.error}` };
  }

  const { body, contentType, locationStripped } = prepared.upload;
  const changed = locationStripped && !sameBytes(body, original);
  if (!changed && contentType === declared) return { outcome: "clean" };

  if (!(await stillCurrent(service, item))) return { outcome: "error", detail: "replaced while being checked; the new file is checked next" };
  // Written by the service role, so the trigger does not queue the clean copy again (owner_id is null on a server write).
  const rewritten = await service.storage.from(bucket).upload(name, body, { contentType, upsert: true });
  if (rewritten.error) return { outcome: "error", detail: `rewrite failed: ${rewritten.error.message}` };
  return { outcome: "cleaned", detail: changed ? "photo metadata removed" : `type corrected to ${contentType}` };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Claims and checks a batch. With `only`, checks just that object, and only if that user wrote it. */
export async function runClientUploadChecks(
  service: Service,
  options: { limit?: number; only?: { bucket: string; name: string; ownerId: string } } = {}
): Promise<{ checked: number; outcomes: Record<UploadCheckOutcome, number> } | { error: string }> {
  const { data, error } = await service.rpc("claim_client_upload_checks", {
    p_limit: options.limit ?? 25,
    p_bucket: options.only?.bucket,
    p_name: options.only?.name,
    p_owner: options.only?.ownerId,
  });
  if (error) return { error: error.message };

  const outcomes: Record<UploadCheckOutcome, number> = { clean: 0, cleaned: 0, quarantined: 0, gone: 0, error: 0 };
  for (const item of (data ?? []) as ClaimedUpload[]) {
    let result: { outcome: UploadCheckOutcome; detail?: string };
    try {
      result = await verifyStoredUpload(service, item);
    } catch (e) {
      result = { outcome: "error", detail: e instanceof Error ? e.message : "check failed" };
    }
    outcomes[result.outcome] += 1;
    const finished = await service.rpc("finish_client_upload_check", {
      p_bucket: item.bucket_id,
      p_name: item.object_name,
      p_status: result.outcome,
      p_detail: result.detail,
    });
    if (finished.error) {
      // The row stays 'checking' and is reclaimed after ten minutes, so the check is redone, not lost.
      Sentry.captureMessage("client upload check: outcome not recorded", { level: "warning", extra: { bucket: item.bucket_id, error: finished.error.message } });
    }
    if (result.outcome === "quarantined" || result.outcome === "error") {
      // Bucket and reason only: the object path carries a patient id.
      Sentry.captureMessage(`client upload check: ${result.outcome}`, {
        level: result.outcome === "quarantined" ? "warning" : "error",
        extra: { bucket: item.bucket_id, detail: result.detail },
      });
    }
  }
  return { checked: (data ?? []).length, outcomes };
}
