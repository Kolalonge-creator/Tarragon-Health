import { preparePhoto, type PhotoPrepareDeps } from "./photo-prepare";

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}
const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 1, 2]);
const dqt = segment(0xdb, [1, 2, 3]);
const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9];
const withExif = Uint8Array.from([0xff, 0xd8, ...exif, ...dqt, ...sos]);
const clean = [0xff, 0xd8, ...dqt, ...sos];

function deps(over: Partial<PhotoPrepareDeps> = {}) {
  const resize = jest.fn(async (uri: string) => `${uri}-resized`);
  const read = jest.fn(async () => withExif);
  return { resize, read, all: { resize, read, ...over } as PhotoPrepareDeps };
}

describe("preparePhoto", () => {
  it("resizes first, reads the resized file, and passes the dimensions through", async () => {
    const d = deps();
    await preparePhoto("file:///a.jpg", 4000, 3000, 1_000_000, d.all);
    expect(d.resize).toHaveBeenCalledWith("file:///a.jpg", 4000, 3000);
    expect(d.read).toHaveBeenCalledWith("file:///a.jpg-resized");
  });

  it("still runs the metadata stripper on the manipulator's output", async () => {
    const d = deps();
    const out = await preparePhoto("u", 100, 100, 1_000_000, d.all);
    expect(Array.from(out as Uint8Array)).toEqual(clean);
  });

  it("falls back to the original photo when resizing throws, and still strips", async () => {
    const d = deps({
      resize: async () => {
        throw new Error("native module failed");
      },
    });
    const out = await preparePhoto("file:///orig.jpg", 100, 100, 1_000_000, d.all);
    expect(d.read).toHaveBeenCalledWith("file:///orig.jpg");
    expect(Array.from(out as Uint8Array)).toEqual(clean);
  });

  it("returns null for non-JPEG bytes, oversize output, or an unreadable file", async () => {
    expect(await preparePhoto("u", 1, 1, 1_000_000, deps({ read: async () => Uint8Array.from([1, 2, 3]) }).all)).toBeNull();
    expect(await preparePhoto("u", 1, 1, 3, deps().all)).toBeNull();
    const failing = deps({
      read: async () => {
        throw new Error("gone");
      },
    });
    expect(await preparePhoto("u", 1, 1, 1_000_000, failing.all)).toBeNull();
  });
});
