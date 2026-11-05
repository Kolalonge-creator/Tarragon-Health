import { checkMyUploadAction } from "./check-my-upload-action";

export const REFUSED_UPLOAD_MESSAGE = "That file is not what it says it is. Save it as a PDF or take a photo, then try again.";

/**
 * After a browser writes a file straight to Storage: asks the server to check it now (security audit 2026-11-05, M-4/L-4).
 * Returns the message to show when the server refused the file (it has already been moved out of reach), otherwise null.
 * A failed request returns null too: the sweep still checks the file, so a slow network never blocks the person.
 */
export async function confirmDirectUpload(bucket: string, path: string): Promise<string | null> {
  try {
    const result = await checkMyUploadAction({ bucket, path });
    return "refused" in result && result.refused ? REFUSED_UPLOAD_MESSAGE : null;
  } catch {
    return null;
  }
}
