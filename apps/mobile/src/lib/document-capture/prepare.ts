import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { resizeTarget, PHOTO_JPEG_QUALITY, PHOTO_MAX_SIDE } from "../written-questions/photo-resize";
import { stripJpegMetadata } from "../written-questions/limits";
import { cropRect, rotatedSize, type Rotation, type Trim } from "./crop";

/** The largest document file kept (the web screen's limit too). A 1600 pixel JPEG is far smaller; this only refuses a large PDF. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface PrepareEdits {
  rotation: Rotation;
  trim: Trim;
}

export interface PrepareDeps {
  /** Rotates, crops, shrinks and re-encodes as JPEG; returns the new file's uri. May throw. */
  render: (uri: string, plan: { rotation: Rotation; crop: ReturnType<typeof cropRect>; resize: ReturnType<typeof resizeTarget> }) => Promise<string>;
  /** Reads the file at a uri into bytes. */
  read: (uri: string) => Promise<Uint8Array>;
}

export type PrepareResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "unreadable" | "too_big" };

/**
 * A photo ready to keep: turned and trimmed as the person chose, shrunk to at most 1600 pixels on its longest side, re-encoded as JPEG (which
 * drops most camera details), and then run through the byte-level metadata stripper so location data is gone whatever the phone's encoder did.
 * Unlike a question photo there is no fallback to the untouched original: a crop the person asked for that cannot be applied is an error, never
 * a different picture saved silently.
 */
export async function prepareDocumentPhoto(uri: string, width: number, height: number, edits: PrepareEdits, deps: PrepareDeps = nativeDeps): Promise<PrepareResult> {
  const crop = cropRect(width, height, edits.rotation, edits.trim);
  const afterTurn = rotatedSize(width, height, edits.rotation);
  const after = crop ? { width: crop.width, height: crop.height } : afterTurn;
  const resize = resizeTarget(after.width, after.height, PHOTO_MAX_SIDE);
  let bytes: Uint8Array;
  try {
    const rendered = await deps.render(uri, { rotation: edits.rotation, crop, resize });
    bytes = await deps.read(rendered);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const clean = stripJpegMetadata(bytes);
  if (!clean || clean.length === 0) return { ok: false, reason: "unreadable" };
  if (clean.length > DOCUMENT_MAX_BYTES) return { ok: false, reason: "too_big" };
  return { ok: true, bytes: clean };
}

/** The only place in the capture module that touches the image manipulator, so Jest can inject another. */
const nativeDeps: PrepareDeps = {
  render: async (uri, plan) => {
    const context = ImageManipulator.manipulate(uri);
    try {
      if (plan.rotation !== 0) context.rotate(plan.rotation);
      if (plan.crop) context.crop(plan.crop);
      if (plan.resize) context.resize(plan.resize);
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });
      return saved.uri;
    } finally {
      context.release();
    }
  },
  read: async (uri) => new Uint8Array(await (await fetch(uri)).arrayBuffer()),
};
