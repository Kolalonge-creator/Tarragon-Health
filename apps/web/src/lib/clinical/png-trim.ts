import { deflateSync, inflateSync } from "node:zlib";

/**
 * Crops the empty margins off a signature PNG so it prints at a useful size.
 *
 * Signatures are usually photographed or exported on a large white or transparent canvas; fitted into the
 * prescription's signature area as-is, the ink ends up a fraction of the box. This finds the bounding box of
 * the "ink" (visible, not near-white) and re-encodes just that region.
 *
 * Deliberately conservative: only 8-bit, non-interlaced greyscale, grey+alpha, RGB and RGBA PNGs are handled, the
 * image is capped at 12 million pixels, and ANY problem (another format, a corrupt file, no ink found, nothing to
 * trim) returns the original bytes unchanged. It never throws, so a signature never blocks a prescription.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PIXELS = 12_000_000;
const PADDING = 6;
const INK_ALPHA_MIN = 24;
const INK_LUMA_MAX = 235;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function trimPngMargins(bytes: Uint8Array): Uint8Array {
  try {
    if (bytes.length < 33 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) return bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let width = 0;
    let height = 0;
    let colorType = -1;
    const idat: Uint8Array[] = [];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR") {
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        const bitDepth = bytes[offset + 16];
        colorType = bytes[offset + 17]!;
        const interlace = bytes[offset + 20];
        if (bitDepth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) return bytes;
      } else if (type === "IDAT") {
        idat.push(data);
      } else if (type === "IEND") {
        break;
      }
      offset += 12 + length;
    }
    if (!width || !height || width * height > MAX_PIXELS || idat.length === 0) return bytes;

    const channels = CHANNELS[colorType]!;
    const stride = width * channels;
    const raw = inflateSync(Buffer.concat(idat));
    if (raw.length < height * (stride + 1)) return bytes;

    // Undo the per-row filters.
    const pixels = new Uint8Array(height * stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const value = raw[src + x]!;
        const left = x >= channels ? pixels[dst + x - channels]! : 0;
        const up = y > 0 ? pixels[dst - stride + x]! : 0;
        const upLeft = y > 0 && x >= channels ? pixels[dst - stride + x - channels]! : 0;
        let recon: number;
        switch (filter) {
          case 0: recon = value; break;
          case 1: recon = value + left; break;
          case 2: recon = value + up; break;
          case 3: recon = value + ((left + up) >> 1); break;
          case 4: recon = value + paeth(left, up, upLeft); break;
          default: return bytes;
        }
        pixels[dst + x] = recon & 0xff;
      }
    }

    // Bounding box of the ink.
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * stride + x * channels;
        const alpha = colorType === 6 ? pixels[p + 3]! : colorType === 4 ? pixels[p + 1]! : 255;
        const luma =
          colorType === 0 || colorType === 4
            ? pixels[p]!
            : 0.299 * pixels[p]! + 0.587 * pixels[p + 1]! + 0.114 * pixels[p + 2]!;
        if (alpha >= INK_ALPHA_MIN && luma <= INK_LUMA_MAX) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return bytes;

    const x0 = Math.max(0, minX - PADDING);
    const y0 = Math.max(0, minY - PADDING);
    const x1 = Math.min(width - 1, maxX + PADDING);
    const y1 = Math.min(height - 1, maxY + PADDING);
    const newWidth = x1 - x0 + 1;
    const newHeight = y1 - y0 + 1;
    // Nothing worth trimming.
    if (newWidth * newHeight > width * height * 0.9) return bytes;

    const newStride = newWidth * channels;
    const filtered = new Uint8Array(newHeight * (newStride + 1));
    for (let y = 0; y < newHeight; y++) {
      filtered[y * (newStride + 1)] = 0;
      filtered.set(
        pixels.subarray((y0 + y) * stride + x0 * channels, (y0 + y) * stride + (x1 + 1) * channels),
        y * (newStride + 1) + 1,
      );
    }

    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, newWidth);
    ihdrView.setUint32(4, newHeight);
    ihdr[8] = 8;
    ihdr[9] = colorType;
    const parts = [
      Uint8Array.from(PNG_SIGNATURE),
      chunk("IHDR", ihdr),
      chunk("IDAT", new Uint8Array(deflateSync(filtered))),
      chunk("IEND", new Uint8Array()),
    ];
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  } catch {
    return bytes;
  }
}

/** Width and height from a PNG header, or null. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
