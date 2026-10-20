import { DOCUMENT_MAX_BYTES, prepareDocumentPhoto, type PrepareDeps } from "./prepare";
import { NO_TRIM } from "./crop";

// A tiny well-formed JPEG: SOI, an APP1 (EXIF with a GPS-like payload) segment, SOS with a byte of data, EOI.
const exif = Uint8Array.from([0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x47, 0x50, 0x53, 0x21]);
const jpegWithExif = Uint8Array.from([0xff, 0xd8, ...exif, 0xff, 0xda, 0x00, 0x03, 0x00, 0x11, 0xff, 0xd9]);

function deps(over: Partial<PrepareDeps> = {}): PrepareDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    render: async (uri, plan) => {
      calls.push({ uri, plan });
      return "file://rendered.jpg";
    },
    read: async () => jpegWithExif,
    ...over,
  };
}

describe("preparing a document photo (S43m)", () => {
  it("removes location data from the bytes whatever the encoder did", async () => {
    const r = await prepareDocumentPhoto("file://a.jpg", 1000, 800, { rotation: 0, trim: NO_TRIM }, deps());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.from(r.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
      expect(Array.from(r.bytes)).not.toContain(0xe1); // the APP1 marker is gone
      expect(Buffer.from(r.bytes).toString("latin1")).not.toContain("GPS");
    }
  });

  it("asks for the turn, the trim and the shrink the person chose, in that order of data", async () => {
    const d = deps();
    await prepareDocumentPhoto("file://a.jpg", 4000, 3000, { rotation: 90, trim: { top: 8, bottom: 0, left: 0, right: 4 } }, d);
    expect(d.calls).toEqual([
      {
        uri: "file://a.jpg",
        plan: { rotation: 90, crop: { originX: 0, originY: 320, width: 2880, height: 3680 }, resize: { height: 1600 } },
      },
    ]);
  });

  it("does not shrink a picture that is already small, and does no crop when nothing is trimmed", async () => {
    const d = deps();
    await prepareDocumentPhoto("file://a.jpg", 1200, 900, { rotation: 0, trim: NO_TRIM }, d);
    expect(d.calls).toEqual([{ uri: "file://a.jpg", plan: { rotation: 0, crop: null, resize: null } }]);
  });

  it("a crop that cannot be applied is an error, never a different picture saved silently", async () => {
    const r = await prepareDocumentPhoto("file://a.jpg", 1000, 800, { rotation: 0, trim: { top: 4, bottom: 0, left: 0, right: 0 } }, deps({ render: async () => { throw new Error("native failure"); } }));
    expect(r).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses bytes that are not a well-formed JPEG, an empty file and an oversized one", async () => {
    expect(await prepareDocumentPhoto("u", 10, 10, { rotation: 0, trim: NO_TRIM }, deps({ read: async () => Uint8Array.from([1, 2, 3, 4, 5]) }))).toEqual({ ok: false, reason: "unreadable" });
    expect(await prepareDocumentPhoto("u", 10, 10, { rotation: 0, trim: NO_TRIM }, deps({ read: async () => new Uint8Array(0) }))).toEqual({ ok: false, reason: "unreadable" });
    const big = new Uint8Array(DOCUMENT_MAX_BYTES + 10);
    big.set([0xff, 0xd8, 0xff, 0xda, 0x00, 0x03, 0x00], 0);
    big.set([0xff, 0xd9], big.length - 2);
    const r = await prepareDocumentPhoto("u", 10, 10, { rotation: 0, trim: NO_TRIM }, deps({ read: async () => big }));
    expect(r).toEqual({ ok: false, reason: "too_big" });
  });
});
