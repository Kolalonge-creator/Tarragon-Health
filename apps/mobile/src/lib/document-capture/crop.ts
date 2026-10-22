/**
 * In-app crop and rotate for a document photo (S43m, spec 2.3): the pure half.
 *
 * Why steppers and not a drag box: the trim is set with four plain buttons, one per edge, so it works with a screen reader, with a large font
 * and on a small low-end screen with no gesture library. Each press trims a fixed step off one edge; the preview shades what will be removed.
 * The numbers here decide that and nothing else, so they are testable without a device.
 */
export const TRIM_STEP_PERCENT = 4;
export const MAX_TRIM_PER_EDGE_PERCENT = 40;
/** Opposite edges together may never remove more than this share, so something is always left to read. */
export const MAX_TRIM_PER_AXIS_PERCENT = 70;

export type Edge = "top" | "bottom" | "left" | "right";
export interface Trim {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export type Rotation = 0 | 90 | 180 | 270;

export const NO_TRIM: Trim = { top: 0, bottom: 0, left: 0, right: 0 };

export function isUntouched(rotation: Rotation, trim: Trim): boolean {
  return rotation === 0 && trim.top === 0 && trim.bottom === 0 && trim.left === 0 && trim.right === 0;
}

/** One step more or less off one edge, kept inside the limits. A step that would break a limit changes nothing. */
export function stepTrim(trim: Trim, edge: Edge, direction: 1 | -1): Trim {
  const next = Math.min(MAX_TRIM_PER_EDGE_PERCENT, Math.max(0, trim[edge] + direction * TRIM_STEP_PERCENT));
  const candidate = { ...trim, [edge]: next };
  const axis = edge === "top" || edge === "bottom" ? candidate.top + candidate.bottom : candidate.left + candidate.right;
  return axis > MAX_TRIM_PER_AXIS_PERCENT ? trim : candidate;
}

export function rotate(rotation: Rotation, direction: "left" | "right"): Rotation {
  return ((rotation + (direction === "right" ? 90 : 270)) % 360) as Rotation;
}

/** The image's size once turned. A quarter turn swaps width and height. */
export function rotatedSize(width: number, height: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * The crop rectangle in pixels of the ROTATED image (the manipulator applies rotate first, then crop), or null when nothing is trimmed.
 * Whole pixels, never empty, never outside the picture.
 */
export function cropRect(width: number, height: number, rotation: Rotation, trim: Trim): { originX: number; originY: number; width: number; height: number } | null {
  if (trim.top === 0 && trim.bottom === 0 && trim.left === 0 && trim.right === 0) return null;
  const size = rotatedSize(width, height, rotation);
  const left = Math.floor((size.width * trim.left) / 100);
  const right = Math.floor((size.width * trim.right) / 100);
  const top = Math.floor((size.height * trim.top) / 100);
  const bottom = Math.floor((size.height * trim.bottom) / 100);
  const w = Math.max(1, size.width - left - right);
  const h = Math.max(1, size.height - top - bottom);
  return { originX: Math.min(left, size.width - 1), originY: Math.min(top, size.height - 1), width: w, height: h };
}
