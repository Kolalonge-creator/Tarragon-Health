/**
 * Removes metadata from a JPEG or PNG before it is stored (spec 12.7). Location, device, time and thumbnail data inside a photo is
 * personal data the care team does not need. The file type is decided from the bytes, never from the name or the declared type.
 *
 * JPEG: the Exif, XMP, IPTC and comment segments (APP1 to APP15 except APP2 colour profile data, and COM) are dropped; the image data
 * is copied untouched. PNG: the text, time and Exif chunks are dropped. Anything else, or a file that does not parse, returns null
 * and is refused (the caller never stores a file it could not clean).
 */
export type CleanImage = { bytes: Uint8Array; contentType: "image/jpeg" | "image/png"; extension: "jpg" | "png" };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME", "dSIG"]);

function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i];
    if (marker === undefined) return null;
    i++;
    if (marker === 0xd9) { out.push(0xff, 0xd9); return Uint8Array.from(out); }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(0xff, marker); continue; } // no length
    if (i + 2 > b.length) return null;
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) return null;
    if (marker === 0xda) {
      // start of scan: copy the header and everything after it (entropy-coded data to the end) untouched
      for (let k = i - 2; k < b.length; k++) out.push(b[k]!);
      return Uint8Array.from(out);
    }
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe;
    if (!drop) { out.push(0xff, marker); for (let k = i; k < i + len; k++) out.push(b[k]!); }
    i += len;
  }
  return null;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || PNG_SIG.some((v, k) => b[k] !== v)) return null;
  const out: number[] = [...PNG_SIG];
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!PNG_DROP.has(type)) for (let k = i; k < end; k++) out.push(b[k]!);
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  return sawEnd ? Uint8Array.from(out) : null;
}

export function stripImageMetadata(input: Uint8Array): CleanImage | null {
  const jpeg = stripJpeg(input);
  if (jpeg) return { bytes: jpeg, contentType: "image/jpeg", extension: "jpg" };
  const png = stripPng(input);
  if (png) return { bytes: png, contentType: "image/png", extension: "png" };
  return null;
}
