/**
 * Removes the Exif (location, device, time) and XMP chunks from a WebP before it is stored (security audit 2026-11-05, M-4/L-4).
 * The image data chunks are copied untouched. When the extended header (VP8X) says Exif or XMP is present, those flags are
 * cleared so readers do not look for chunks that are gone. Returns null when the file is not a well-formed WebP.
 */
const DROP = new Set(["EXIF", "XMP "]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

export function stripWebpMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length < 20 || fourcc(b, 0) !== "RIFF" || fourcc(b, 8) !== "WEBP") return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > b.length) return null;
  const kept: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = fourcc(b, i);
    const size = view.getUint32(i + 4, true);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > riffEnd) return null;
    if (!DROP.has(type)) {
      const chunk = b.slice(i, Math.min(end, riffEnd));
      if (type === "VP8X" && size >= 1) chunk[8] = chunk[8]! & ~(VP8X_EXIF | VP8X_XMP);
      kept.push(chunk);
    }
    i = end;
  }
  if (kept.length === 0) return null;
  const bodyLength = kept.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + bodyLength);
  out.set(b.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(4, 4 + bodyLength, true);
  let at = 12;
  for (const c of kept) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
