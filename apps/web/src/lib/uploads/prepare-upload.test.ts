/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): uploads are checked against their real bytes, and photos lose location metadata.
 * The files below are tiny hand-built ones carrying a "GPS-HERE" marker in their metadata.
 */
import { prepareUpload } from "./prepare-upload";
import { stripWebpMetadata } from "./strip-webp-metadata";

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));
const file = (bytes: number[] | Uint8Array, type: string) => new File([Uint8Array.from(bytes)], "x", { type });

function jpegWithExif(): number[] {
  const exif = [...enc("Exif"), 0, 0, ...enc("GPS-HERE")];
  return [0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xda, 0, 2, 0x11, 0x22, 0x33, 0xff, 0xd9];
}

function pngWithText(): number[] {
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...enc(type), ...data, 0, 0, 0, 0];
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", Array(13).fill(1)), ...chunk("tEXt", enc("GPS-HERE")), ...chunk("IDAT", [1, 2]), ...chunk("IEND", [])];
}

function webpWithExif(): Uint8Array {
  const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  const chunk = (type: string, data: number[]) => [...enc(type), ...le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
  const body = [
    ...enc("WEBP"),
    ...chunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk("VP8 ", [9, 9, 9, 9]),
    ...chunk("EXIF", enc("GPS-HERE!")),
    ...chunk("XMP ", enc("<x/>")),
  ];
  return Uint8Array.from([...enc("RIFF"), ...le(body.length), ...body]);
}

describe("prepareUpload", () => {
  it("removes JPEG location metadata and keeps the image data", async () => {
    const r = await prepareUpload(file(jpegWithExif(), "image/jpeg"));
    if (!r.ok) throw new Error(r.error);
    expect(has(r.upload.body, "GPS-HERE")).toBe(false);
    expect(Array.from(r.upload.body.slice(-5))).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
    expect(r.upload).toMatchObject({ contentType: "image/jpeg", locationStripped: true });
  });

  it("removes PNG text metadata", async () => {
    const r = await prepareUpload(file(pngWithText(), "image/png"));
    if (!r.ok) throw new Error(r.error);
    expect(has(r.upload.body, "GPS-HERE")).toBe(false);
    expect(has(r.upload.body, "IDAT")).toBe(true);
  });

  it("removes WebP Exif and XMP and clears their header flags", async () => {
    const r = await prepareUpload(file(webpWithExif(), "image/webp"));
    if (!r.ok) throw new Error(r.error);
    const out = r.upload.body;
    expect(has(out, "GPS-HERE")).toBe(false);
    expect(has(out, "XMP ")).toBe(false);
    expect(has(out, "VP8 ")).toBe(true);
    expect(out[20]! & 0x0c).toBe(0);
    expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true)).toBe(out.length - 8);
  });

  it("stores a PDF as it is", async () => {
    const pdf = enc("%PDF-1.7\n1 0 obj\n");
    const r = await prepareUpload(file(pdf, "application/pdf"));
    if (!r.ok) throw new Error(r.error);
    expect(Array.from(r.upload.body)).toEqual(pdf);
    expect(r.upload.locationStripped).toBe(false);
  });

  it("refuses a file whose bytes are not what it claims", async () => {
    expect((await prepareUpload(file(enc("<html><script>x</script>"), "application/pdf"))).ok).toBe(false);
    expect((await prepareUpload(file(enc("%PDF-1.7"), "image/jpeg"))).ok).toBe(false);
  });

  it("keeps a clinical photo it cannot clean, but refuses it when the photo will be public", async () => {
    const broken = [0xff, 0xd8, 0xff, 0x00, 0x01];
    expect((await prepareUpload(file(broken, "image/jpeg"))).ok).toBe(true);
    expect((await prepareUpload(file(broken, "image/jpeg"), { requireClean: true })).ok).toBe(false);
  });
});

describe("stripWebpMetadata", () => {
  it("returns null for something that is not a WebP", () => {
    expect(stripWebpMetadata(Uint8Array.from(enc("RIFFxxxxWAVEfmt ")))).toBeNull();
  });
});

describe("prepareUpload with XML traces (testing-day ECG exports)", () => {
  const xml = (text: string) => new File([new TextEncoder().encode(text)], "trace.xml", { type: "text/xml" });
  it("accepts an XML export only where XML is allowed", async () => {
    const trace = '<?xml version="1.0"?><AnnotatedECG/>';
    expect((await prepareUpload(xml(trace), { allowXml: true })).ok).toBe(true);
    expect((await prepareUpload(xml(trace))).ok).toBe(false);
  });
  it("refuses HTML or script dressed as XML", async () => {
    expect((await prepareUpload(xml("<html><body/></html>"), { allowXml: true })).ok).toBe(false);
    expect((await prepareUpload(xml('<?xml version="1.0"?><script>alert(1)</script>'), { allowXml: true })).ok).toBe(false);
  });
});
