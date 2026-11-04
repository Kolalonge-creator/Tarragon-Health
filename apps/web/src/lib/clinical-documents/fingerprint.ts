import { createHash } from "crypto";

/**
 * Clinical document engine, step 1 (docs/plans/clinical-document-engine-2026-11-04.md §8.5): the SHA-256 of an uploaded file,
 * computed by the server that received it. The database refuses the same file twice in one patient's record
 * (private.cde_open_intake), whoever uploads it, so a lab emailing the same report to the patient and to the care team ends up
 * in the record once. Never taken from the browser: a client-supplied hash could be anything.
 */
export async function fileSha256(file: Blob): Promise<string> {
  return createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
}
