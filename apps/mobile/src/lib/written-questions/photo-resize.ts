import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** The longest side a question photo is sent at; a clear photo of a rash or a label needs no more. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.7;

/** Which dimension to constrain so the LONGEST side ends at the limit, or null when already small enough. */
export function resizeTarget(width: number | null, height: number | null, maxSide: number): { width: number } | { height: number } | null {
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

/**
 * The only module that touches expo-image-manipulator, so Jest can mock it. Resizes to at most
 * `maxSide` on the longest side and re-encodes as JPEG, which also drops EXIF. Returns the new
 * file's uri. Throws on failure; the caller falls back to the original photo.
 */
export async function resizeToJpeg(uri: string, width: number | null, height: number | null): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  try {
    const target = resizeTarget(width, height, PHOTO_MAX_SIDE);
    if (target) context.resize(target);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });
    return saved.uri;
  } finally {
    context.release();
  }
}
