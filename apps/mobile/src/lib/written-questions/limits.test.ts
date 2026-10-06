import { checkPhotoAdd, checkQuestionLength, photoStoragePath, stripJpegMetadata } from "./limits";

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

describe("checkQuestionLength", () => {
  it("enforces 10 to 2000 characters on trimmed text", () => {
    expect(checkQuestionLength("too short")).toEqual({ ok: false, key: "wq.error.length" });
    expect(checkQuestionLength("          x          ")).toEqual({ ok: false, key: "wq.error.length" });
    expect(checkQuestionLength("0123456789").ok).toBe(true);
    expect(checkQuestionLength("a".repeat(2001)).ok).toBe(false);
  });
});

describe("checkPhotoAdd", () => {
  it("allows up to the limit and refuses the next", () => {
    expect(checkPhotoAdd(2, 1000, 3, 8_388_608).ok).toBe(true);
    expect(checkPhotoAdd(3, 1000, 3, 8_388_608)).toEqual({ ok: false, reason: "limit" });
  });
  it("refuses an oversize or empty photo", () => {
    expect(checkPhotoAdd(0, 8_388_609, 3, 8_388_608)).toEqual({ ok: false, reason: "too_big" });
    expect(checkPhotoAdd(0, 8_388_608, 3, 8_388_608).ok).toBe(true);
    expect(checkPhotoAdd(0, 0, 3, 8_388_608)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("photoStoragePath", () => {
  it("builds user/consult/uuid.jpg", () => {
    expect(photoStoragePath("u1", "c1", "p1")).toBe("u1/c1/p1.jpg");
  });
});

describe("stripJpegMetadata", () => {
  const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 1, 2, 3, 4]); // pretend GPS-bearing EXIF
  const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
  const icc = segment(0xe2, [9, 9]);
  const dqt = segment(0xdb, [1, 2, 3]);
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9];

  it("removes EXIF and keeps picture segments and scan data", () => {
    const input = Uint8Array.from([0xff, 0xd8, ...jfif, ...exif, ...icc, ...dqt, ...sos]);
    const out = stripJpegMetadata(input);
    expect(out).not.toBeNull();
    const bytes = Array.from(out as Uint8Array);
    expect(bytes.includes(0xe1)).toBe(false);
    expect(bytes).toEqual([0xff, 0xd8, ...jfif, ...icc, ...dqt, ...sos]);
  });
  it("removes APP13 and comments too", () => {
    const input = Uint8Array.from([0xff, 0xd8, ...segment(0xed, [1]), ...segment(0xfe, [65]), ...dqt, ...sos]);
    expect(Array.from(stripJpegMetadata(input) as Uint8Array)).toEqual([0xff, 0xd8, ...dqt, ...sos]);
  });
  it("refuses bytes that are not a JPEG", () => {
    expect(stripJpegMetadata(Uint8Array.from([1, 2, 3, 4, 5]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array(0))).toBeNull();
  });
  it("refuses a truncated segment", () => {
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 1]))).toBeNull();
  });
});
