import { describe, expect, it } from "@jest/globals";
import { stripImageMetadata } from "./strip-image-metadata";

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53]; // "Exif" then something that looks like GPS
const jpeg = Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), ...seg(0xe1, exif), ...seg(0xfe, [0x68, 0x69]), ...seg(0xdb, [1, 2, 3]), ...seg(0xda, [0, 1]), 0x11, 0x22, 0xff, 0xd9]);

const chunk = (type: string, data: number[]) => {
  const t = [...type].map((c) => c.charCodeAt(0));
  return [0, 0, 0, data.length, ...t, ...data, 0, 0, 0, 0];
};
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), ...chunk("eXIf", [1, 2, 3]), ...chunk("tEXt", [65, 0, 66]), ...chunk("IDAT", [9, 9]), ...chunk("IEND", [])]);

const contains = (hay: Uint8Array, needle: number[]) => hay.some((_, i) => needle.every((n, k) => hay[i + k] === n));

describe("stripImageMetadata", () => {
  it("removes Exif and comments from a JPEG and keeps the image data", () => {
    const r = stripImageMetadata(jpeg)!;
    expect(r.contentType).toBe("image/jpeg");
    expect(contains(r.bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false);
    expect(contains(r.bytes, [0x68, 0x69])).toBe(false);
    expect(contains(r.bytes, [0xff, 0xdb])).toBe(true);
    expect(contains(r.bytes, [0x11, 0x22, 0xff, 0xd9])).toBe(true);
    expect(r.bytes.length).toBeLessThan(jpeg.length);
  });
  it("removes Exif and text chunks from a PNG and keeps the image chunks", () => {
    const r = stripImageMetadata(png)!;
    expect(r.contentType).toBe("image/png");
    expect(contains(r.bytes, [0x65, 0x58, 0x49, 0x66])).toBe(false);
    expect(contains(r.bytes, [0x74, 0x45, 0x58, 0x74])).toBe(false);
    expect(contains(r.bytes, [0x49, 0x44, 0x41, 0x54])).toBe(true);
  });
  it("refuses anything that is not a JPEG or PNG, or does not parse (by its bytes, not its name)", () => {
    expect(stripImageMetadata(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(stripImageMetadata(Uint8Array.from([0xff, 0xd8, 0x00]))).toBeNull();
    expect(stripImageMetadata(png.slice(0, 20))).toBeNull();
    expect(stripImageMetadata(new Uint8Array())).toBeNull();
  });
});
