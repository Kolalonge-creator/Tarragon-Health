import { sameApplicationServerKey } from "./same-application-server-key";

const key = (...n: number[]) => new Uint8Array(n);

describe("sameApplicationServerKey", () => {
  it("matches an identical key", () => {
    expect(sameApplicationServerKey(key(4, 1, 2).buffer as ArrayBuffer, key(4, 1, 2))).toBe(true);
  });

  it("rejects a subscription made with a rotated key", () => {
    expect(sameApplicationServerKey(key(4, 1, 2).buffer as ArrayBuffer, key(4, 9, 9))).toBe(false);
  });

  it("rejects a key of a different length", () => {
    expect(sameApplicationServerKey(key(4, 1).buffer as ArrayBuffer, key(4, 1, 2))).toBe(false);
  });

  it("keeps a subscription that does not expose its key", () => {
    expect(sameApplicationServerKey(null, key(4, 1, 2))).toBe(true);
    expect(sameApplicationServerKey(undefined, key(4, 1, 2))).toBe(true);
  });
});
