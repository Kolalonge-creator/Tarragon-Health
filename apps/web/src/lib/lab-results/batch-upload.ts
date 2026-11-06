/**
 * Sending several result files in one go (patient dashboard 2.0, spec 9.2, gap P11).
 *
 * Each file goes through the same server action as a single upload (uploadResultDocumentAsPatient: scan, signature check,
 * rate limit, AI read, care-team task), one after another, so nothing about the review pipeline changes. A result that came
 * as several photos is sent as several documents, each noted "Page n of N" so the doctor reads them together. One failed
 * file never stops the others, and the failed ones are reported back so the patient can try just those again.
 */

/** At most this many files per send: well inside the upload rate limit (security.abuse_rate_limits.upload, 30 an hour). */
export const MAX_RESULT_FILES = 10;

const NOTE_MAX = 500;

/** The note sent with file `index` (0-based) of `total`. A single file keeps the patient's note exactly as typed. */
export function noteForFile(note: string, index: number, total: number): string | undefined {
  const typed = note.trim();
  if (total <= 1) return typed || undefined;
  const page = `Page ${index + 1} of ${total}.`;
  return (typed ? `${page} ${typed}` : page).slice(0, NOTE_MAX);
}

export type FileSendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends `files` one at a time with `send` and returns one result per file, in order. `send` must not throw for an ordinary
 * refusal (it returns `{ error }`); a throw (a network failure) is caught and recorded against that file only.
 */
export async function sendResultFiles(
  files: readonly File[],
  send: (file: File, index: number, total: number) => Promise<{ error?: string | null }>,
  onProgress?: (done: number, total: number) => void,
): Promise<FileSendResult[]> {
  const results: FileSendResult[] = [];
  for (let i = 0; i < files.length; i += 1) {
    try {
      const outcome = await send(files[i]!, i, files.length);
      results.push(outcome.error ? { ok: false, error: outcome.error } : { ok: true });
    } catch {
      results.push({ ok: false, error: "This file did not send. Check your connection and try again." });
    }
    onProgress?.(i + 1, files.length);
  }
  return results;
}
