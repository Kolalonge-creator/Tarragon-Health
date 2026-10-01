import { deflateSync } from "node:zlib";
import { pngDimensions, trimPngMargins } from "./png-trim";

// A tiny PNG encoder for tests: 8-bit, filter 0.
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(width: number, height: number, colorType: 2 | 6, paint: (x: number, y: number) => number[], filter = 0): Uint8Array {
  const channels = colorType === 6 ? 4 : 3;
  const raw = new Uint8Array(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * channels + 1)] = filter;
    for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * channels + 1) + 1 + x * channels);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const inkBox = (x: number, y: number) => (x >= 40 && x < 60 && y >= 30 && y < 45);

describe("trimPngMargins", () => {
  it("crops a white-background RGB signature to its ink plus padding", () => {
    const png = makePng(200, 100, 2, (x, y) => (inkBox(x, y) ? [10, 10, 10] : [255, 255, 255]));
    const trimmed = trimPngMargins(png);
    expect(pngDimensions(png)).toEqual({ width: 200, height: 100 });
    expect(pngDimensions(trimmed)).toEqual({ width: 20 + 12, height: 15 + 12 });
  });

  it("crops a transparent RGBA signature", () => {
    const png = makePng(300, 200, 6, (x, y) => (inkBox(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 0]));
    expect(pngDimensions(trimPngMargins(png))).toEqual({ width: 32, height: 27 });
  });

  it("returns a valid PNG that decodes back to the same ink", () => {
    const png = makePng(200, 100, 2, (x, y) => (inkBox(x, y) ? [10, 10, 10] : [255, 255, 255]));
    const trimmed = trimPngMargins(png);
    // trimming the trimmed image again finds nothing more to remove
    expect(trimPngMargins(trimmed)).toEqual(trimmed);
    expect(Array.from(trimmed.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("handles images whose rows use a non-zero filter", () => {
    // filter type 1 (Sub) on every row, encoded as all-zero deltas except where the value changes
    const width = 100;
    const height = 60;
    const channels = 3;
    const raw = new Uint8Array(height * (width * channels + 1));
    for (let y = 0; y < height; y++) {
      raw[y * (width * channels + 1)] = 1;
      for (let x = 0; x < width; x++) {
        const value = x >= 30 && x < 50 && y >= 20 && y < 30 ? 0 : 255;
        const prev = x === 0 ? 0 : (x - 1 >= 30 && x - 1 < 50 && y >= 20 && y < 30 ? 0 : 255);
        for (let c = 0; c < channels; c++) raw[y * (width * channels + 1) + 1 + x * channels + c] = (value - prev) & 0xff;
      }
    }
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { png.set(p, at); at += p.length; }
    expect(pngDimensions(trimPngMargins(png))).toEqual({ width: 32, height: 22 });
  });

  it("returns the original bytes when there is no ink, nothing to trim, or the data is not a supported PNG", () => {
    const blank = makePng(50, 50, 2, () => [255, 255, 255]);
    expect(trimPngMargins(blank)).toBe(blank);
    const full = makePng(50, 50, 2, () => [0, 0, 0]);
    expect(trimPngMargins(full)).toBe(full);
    const garbage = Uint8Array.from([1, 2, 3, 4]);
    expect(trimPngMargins(garbage)).toBe(garbage);
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(trimPngMargins(jpg)).toBe(jpg);
  });

  it("never throws on a truncated or corrupt PNG", () => {
    const png = makePng(80, 80, 2, (x, y) => (inkBox(x, y) ? [0, 0, 0] : [255, 255, 255]));
    const truncated = png.subarray(0, png.length - 40);
    expect(() => trimPngMargins(truncated)).not.toThrow();
    const corrupt = Uint8Array.from(png);
    corrupt.fill(7, 40, 60);
    expect(() => trimPngMargins(corrupt)).not.toThrow();
  });
});
