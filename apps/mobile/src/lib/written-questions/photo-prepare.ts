import { stripJpegMetadata } from "./limits";

export interface PhotoPrepareDeps {
  /** Resizes and re-encodes; returns the new file's uri. May throw. */
  resize: (uri: string, width: number | null, height: number | null) => Promise<string>;
  /** Reads the file at a uri into bytes. */
  read: (uri: string) => Promise<Uint8Array>;
}

/**
 * Prepares a picked photo for sending: resize and re-encode first (smaller, and EXIF gone), then
 * the pure JPEG metadata stripper as a second guard, then the size check. If resizing fails for
 * any reason the original file goes through the stripper instead: a photo problem must never stop
 * a patient sending their question. Null means unreadable, not a JPEG, empty or over the limit.
 */
export async function preparePhoto(
  uri: string,
  width: number | null,
  height: number | null,
  maxBytes: number,
  deps: PhotoPrepareDeps,
): Promise<Uint8Array | null> {
  let sourceUri = uri;
  try {
    sourceUri = await deps.resize(uri, width, height);
  } catch {
    sourceUri = uri;
  }
  try {
    const clean = stripJpegMetadata(await deps.read(sourceUri));
    if (!clean || clean.length === 0 || clean.length > maxBytes) return null;
    return clean;
  } catch {
    return null;
  }
}
