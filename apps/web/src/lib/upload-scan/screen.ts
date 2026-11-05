import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createScannerClientFromEnv, type Database, type ScannerClient } from "@tarragon/shared";
import { fileSha256 } from "@/lib/clinical-documents/fingerprint";

/**
 * T2-08: the malware scan of an uploaded clinical document, run BEFORE the file is stored. A step of the clinical document
 * engine's intake (see supabase/migrations/20261104233613_t2_08_upload_malware_scan.sql): the verdict is recorded against the
 * file's SHA-256, and the intake insert trigger turns it into clinical_documents.scan_status.
 *
 *   scanner off (no SCANNER_SERVICE_URL)  -> { ok: true, verdict: "off" }       nothing recorded; the document is 'unscanned'
 *   clean                                -> { ok: true, verdict: "clean" }     stored and processed normally
 *   infected                             -> { ok: false, error }               NEVER stored; calm refusal; security incident
 *   scanner unreachable / could not scan -> { ok: true, verdict: "held" }      stored, but 'pending_scan': no reader, no file link,
 *                                                                               ops told; the daily retry rescans it
 *
 * Deliberately NOT a "use server" module: it takes a service-role client, and an exported function in a "use server" file would
 * be callable from a browser. Never throws.
 */

/** Shown to whoever uploaded an infected file. Plain, calm, says what to do next, and does not alarm. */
export const INFECTED_UPLOAD_MESSAGE =
  "We could not accept this file because our safety check flagged it. Please ask the lab for a fresh copy, or take a new photo of the printed result, and upload that instead.";

/** The scanner could not be reached AND the hold could not be recorded: refusing is the only safe answer. */
export const SCAN_NOT_RECORDED_MESSAGE = "We could not save this file just now. Please try again in a few minutes.";

export type ScreenOutcome =
  | { ok: true; verdict: "off" | "clean" | "held"; sha256: string }
  | { ok: false; error: string };

export type ScreenContext = { patientId: string; uploadedBy: string | null };

type ScanVerdict = "clean" | "infected" | "unavailable";

export type ScanFacts = { verdict: ScanVerdict; signature: string | null; engineVersion: string | null; dbVersion: string | null; detail: string | null };

/** Scan bytes and reduce the answer to one of three verdicts. Anything not clearly clean or infected is "unavailable". */
export async function scanBytes(client: ScannerClient, bytes: Blob, expectedSha256: string): Promise<ScanFacts> {
  const result = await client.scan(bytes);
  if (!result) return { verdict: "unavailable", signature: null, engineVersion: null, dbVersion: null, detail: "scanner unreachable" };
  // The scanner hashes what it received; a mismatch means the bytes it scanned are not the bytes being stored.
  if (result.sha256 !== expectedSha256) {
    return { verdict: "unavailable", signature: null, engineVersion: result.engine_version, dbVersion: result.db_version, detail: "fingerprint mismatch" };
  }
  if (result.status === "clean" || result.status === "infected") {
    return {
      verdict: result.status,
      signature: result.signature,
      engineVersion: result.engine_version,
      dbVersion: result.db_version,
      detail: null,
    };
  }
  return { verdict: "unavailable", signature: null, engineVersion: result.engine_version, dbVersion: result.db_version, detail: result.detail ?? "scan error" };
}

export async function screenUpload(
  service: SupabaseClient<Database>,
  file: Blob & { type?: string },
  ctx: ScreenContext,
  client: ScannerClient | null = createScannerClientFromEnv(),
): Promise<ScreenOutcome> {
  let sha256: string;
  try {
    sha256 = await fileSha256(file);
  } catch {
    return { ok: false, error: SCAN_NOT_RECORDED_MESSAGE };
  }
  if (!client) return { ok: true, verdict: "off", sha256 };

  const facts = await scanBytes(client, file, sha256);
  let recorded = false;
  try {
    const { error } = await service.rpc("record_upload_scan", {
      p_sha256: sha256,
      p_verdict: facts.verdict,
      p_signature: facts.signature as string,
      p_engine_version: facts.engineVersion as string,
      p_db_version: facts.dbVersion as string,
      p_patient: ctx.patientId,
      p_uploaded_by: ctx.uploadedBy as string,
      p_size_bytes: file.size,
      p_mime_type: (file.type || null) as string,
    });
    recorded = !error;
    if (error) console.error("upload-scan: could not record the verdict", error.message);
  } catch (error) {
    console.error("upload-scan: could not record the verdict", error);
  }

  if (facts.verdict === "infected") {
    console.warn("upload-scan: refused an infected upload", { signature: facts.signature, sha256: sha256.slice(0, 16) });
    return { ok: false, error: INFECTED_UPLOAD_MESSAGE };
  }
  if (facts.verdict === "unavailable") {
    // Without a recorded 'unavailable' verdict the document would arrive as 'unscanned' and be processed: refuse instead.
    if (!recorded) return { ok: false, error: SCAN_NOT_RECORDED_MESSAGE };
    console.warn("upload-scan: scanner unavailable, holding the upload", { detail: facts.detail, sha256: sha256.slice(0, 16) });
    return { ok: true, verdict: "held", sha256 };
  }
  // Clean but not recorded: the document is 'unscanned' (processed as before T2-08) and the retry's backfill rescans it.
  return { ok: true, verdict: "clean", sha256 };
}
