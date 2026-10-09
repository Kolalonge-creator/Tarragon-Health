/**
 * Community pictures: what the server does to a file BEFORE it is stored.
 *
 *  - The real type is read from the file's own bytes (never the browser's word for it). Only JPEG and PNG are accepted.
 *  - Everything that is not needed to draw the picture is dropped: camera and phone details, GPS position, thumbnails, comments,
 *    colour-profile blobs and text chunks. A photograph straight from a phone carries where and when it was taken.
 *  - The picture itself is never re-drawn, so there is nothing to scale or compress here: a file over the size limit is refused.
 *  - Width and height come from the file header and are bounded, so a tiny file that expands into a huge image is refused.
 *
 * Pure functions on bytes: no network, no filesystem, no dependencies.
 */
export type SanitisedImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png"; ext: "jpg" | "png"; width: number; height: number };
export type SanitiseError = "empty" | "too_large" | "unsupported" | "corrupt" | "dimensions";
export type SanitiseResult = { ok: true; image: SanitisedImage } | { ok: false; error: SanitiseError };

const MAX_SIDE = 20000;
const MAX_PIXELS = 50_000_000;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function dimensionsOk(w: number, h: number): boolean {
  return w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_PIXELS;
}

function sanitiseJpeg(b: Uint8Array): SanitiseResult {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { ok: false, error: "corrupt" };
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let sawEnd = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, error: "corrupt" };
    while (i < b.length && b[i] === 0xff) i += 1; // fill bytes
    const marker = b[i];
    if (marker === undefined) return { ok: false, error: "corrupt" };
    i += 1;
    if (marker === 0xd9) {
      out.push(Uint8Array.of(0xff, 0xd9));
      sawEnd = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 2 > b.length) return { ok: false, error: "corrupt" };
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) return { ok: false, error: "corrupt" };
    const segment = b.subarray(i - 2, i + len); // FF xx len data
    const keep = marker === 0xe0 /* JFIF */ || (marker >= 0xc0 && marker <= 0xcf) || marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xda;
    // APP1 to APP15 (EXIF, XMP, ICC, Adobe) and comments are dropped. APP0 keeps only the 14-byte JFIF header.
    if (marker === 0xe0) {
      const jfif = len > 16 ? b.subarray(i - 2, i + 16) : segment;
      if (len > 16) {
        const fixed = new Uint8Array(jfif);
        fixed[2] = 0;
        fixed[3] = 16; // length 16: no thumbnail
        fixed[16] = 0;
        fixed[17] = 0; // thumbnail width and height 0
        out.push(fixed);
      } else {
        out.push(segment);
      }
    } else if (keep) {
      out.push(segment);
    }
    if ((marker >= 0xc0 && marker <= 0xc2) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (len < 9) return { ok: false, error: "corrupt" };
      height = (b[i + 3]! << 8) | b[i + 4]!;
      width = (b[i + 5]! << 8) | b[i + 6]!;
    }
    i += len;
    if (marker === 0xda) {
      sawScan = true;
      // entropy-coded data: copy until the next real marker (FF followed by something other than 00 or RSTn)
      const start = i;
      while (i < b.length) {
        if (b[i] === 0xff) {
          const next = b[i + 1];
          if (next === undefined) return { ok: false, error: "corrupt" };
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2;
            continue;
          }
          if (next === 0xff) {
            i += 1;
            continue;
          }
          break;
        }
        i += 1;
      }
      out.push(b.subarray(start, i));
    }
  }
  if (!sawScan || !sawEnd) return { ok: false, error: "corrupt" };
  if (!dimensionsOk(width, height)) return { ok: false, error: "dimensions" };
  return { ok: true, image: { bytes: concat(out), mime: "image/jpeg", ext: "jpg", width, height } };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);

function sanitisePng(b: Uint8Array): SanitiseResult {
  if (b.length < 33 || PNG_SIGNATURE.some((v, k) => b[k] !== v)) return { ok: false, error: "corrupt" };
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawEnd = false;
  while (i + 8 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return { ok: false, error: "corrupt" };
    if (!sawIhdr && type !== "IHDR") return { ok: false, error: "corrupt" };
    if (type === "IHDR") {
      if (len !== 13) return { ok: false, error: "corrupt" };
      width = ((b[i + 8]! << 24) | (b[i + 9]! << 16) | (b[i + 10]! << 8) | b[i + 11]!) >>> 0;
      height = ((b[i + 12]! << 24) | (b[i + 13]! << 16) | (b[i + 14]! << 8) | b[i + 15]!) >>> 0;
      sawIhdr = true;
    }
    if (type === "IDAT") sawIdat = true;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawIhdr || !sawIdat || !sawEnd) return { ok: false, error: "corrupt" };
  if (!dimensionsOk(width, height)) return { ok: false, error: "dimensions" };
  return { ok: true, image: { bytes: concat(out), mime: "image/png", ext: "png", width, height } };
}

export function sanitiseImage(input: Uint8Array, maxBytes: number): SanitiseResult {
  if (input.length === 0) return { ok: false, error: "empty" };
  // Read at most a little more than the limit before judging: an enormous upload is refused without parsing it.
  if (input.length > maxBytes * 2) return { ok: false, error: "too_large" };
  let result: SanitiseResult;
  if (input[0] === 0xff && input[1] === 0xd8) result = sanitiseJpeg(input);
  else if (input[0] === 0x89 && input[1] === 0x50) result = sanitisePng(input);
  else return { ok: false, error: "unsupported" };
  if (result.ok && result.image.bytes.length > maxBytes) return { ok: false, error: "too_large" };
  return result;
}
