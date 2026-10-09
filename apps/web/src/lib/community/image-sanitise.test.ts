import { describe, expect, it } from "@jest/globals";
import { sanitiseImage } from "./image-sanitise";

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const has = (hay: Uint8Array, needle: string): boolean => Buffer.from(hay).includes(Buffer.from(needle, "latin1"));

/** A minimal JPEG: SOI, JFIF with a thumbnail, EXIF (with a GPS-looking string), a comment, DQT, SOF0, SOS with data, EOI. */
function jpeg(width: number, height: number): Uint8Array {
  const jfif = [0xff, 0xe0, ...be16(2 + 17), ...ascii("JFIF"), 0, 1, 1, 0, ...be16(1), ...be16(1), 1, 1, 9, 9, 9];
  const exif = [0xff, 0xe1, ...be16(2 + 22), ...ascii("Exif\0\0GPSLatitude12345")];
  const comment = [0xff, 0xfe, ...be16(2 + 8), ...ascii("my phone")];
  const dqt = [0xff, 0xdb, ...be16(2 + 65), 0, ...Array<number>(64).fill(8)];
  const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  const data = [0x12, 0x34, 0xff, 0x00, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...exif, ...comment, ...dqt, ...sof, ...sos, ...data, 0xff, 0xd9]);
}

function pngChunk(type: string, data: number[]): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function png(width: number, height: number): Uint8Array {
  const ihdr = pngChunk("IHDR", [...be32(width), ...be32(height), 8, 2, 0, 0, 0]);
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...ihdr,
    ...pngChunk("eXIf", ascii("GPSLatitude")),
    ...pngChunk("tEXt", ascii("Comment\0my phone")),
    ...pngChunk("IDAT", [1, 2, 3, 4]),
    ...pngChunk("IEND", []),
  ]);
}

describe("sanitiseImage", () => {
  it("drops location and camera details from a JPEG and keeps the picture", () => {
    const r = sanitiseImage(jpeg(800, 600), 5_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.mime).toBe("image/jpeg");
    expect(r.image.ext).toBe("jpg");
    expect([r.image.width, r.image.height]).toEqual([800, 600]);
    expect(has(r.image.bytes, "Exif")).toBe(false);
    expect(has(r.image.bytes, "GPSLatitude")).toBe(false);
    expect(has(r.image.bytes, "my phone")).toBe(false);
    expect(r.image.bytes[0]).toBe(0xff);
    expect(r.image.bytes[1]).toBe(0xd8);
    expect(r.image.bytes.at(-1)).toBe(0xd9);
    expect(has(r.image.bytes, "JFIF")).toBe(true);
  });

  it("drops text and exif chunks from a PNG and keeps the picture", () => {
    const r = sanitiseImage(png(100, 50), 5_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.mime).toBe("image/png");
    expect([r.image.width, r.image.height]).toEqual([100, 50]);
    expect(has(r.image.bytes, "eXIf")).toBe(false);
    expect(has(r.image.bytes, "tEXt")).toBe(false);
    expect(has(r.image.bytes, "IDAT")).toBe(true);
    expect(has(r.image.bytes, "IEND")).toBe(true);
  });

  it("goes by the bytes, not by what the sender called the file", () => {
    expect(sanitiseImage(Uint8Array.from(ascii("GIF89a....")), 5_000_000)).toEqual({ ok: false, error: "unsupported" });
    expect(sanitiseImage(Uint8Array.from(ascii("<svg onload=alert(1)>")), 5_000_000)).toEqual({ ok: false, error: "unsupported" });
    expect(sanitiseImage(new Uint8Array(0), 5_000_000)).toEqual({ ok: false, error: "empty" });
  });

  it("refuses a truncated or damaged file", () => {
    expect(sanitiseImage(jpeg(10, 10).subarray(0, 40), 5_000_000)).toEqual({ ok: false, error: "corrupt" });
    expect(sanitiseImage(png(10, 10).subarray(0, 30), 5_000_000)).toEqual({ ok: false, error: "corrupt" });
  });

  it("refuses a picture whose size would expand into something huge", () => {
    expect(sanitiseImage(jpeg(20001, 10), 5_000_000)).toEqual({ ok: false, error: "dimensions" });
    expect(sanitiseImage(png(10000, 10000), 5_000_000)).toEqual({ ok: false, error: "dimensions" });
    expect(sanitiseImage(png(0, 10), 5_000_000)).toEqual({ ok: false, error: "dimensions" });
  });

  it("refuses a file over the limit", () => {
    expect(sanitiseImage(jpeg(10, 10), 20)).toEqual({ ok: false, error: "too_large" });
  });
});
