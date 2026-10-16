/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { configuredScanner, scanPicture, type ImageScanner } from "./image-scan";

const bytes = new Uint8Array([1, 2, 3]);
const make = (impl: ImageScanner["scan"]): ImageScanner => ({ name: "test", scan: impl });

describe("the automatic picture check", () => {
  it("is off by default: no provider named means unavailable, and nothing is called", async () => {
    expect(configuredScanner({})).toBeNull();
    expect(await scanPicture(bytes, "image/jpeg", configuredScanner({}))).toBe("unavailable");
  });
  it("an unknown provider name is off, never a guess (including inherited names)", () => {
    expect(configuredScanner({ COMMUNITY_IMAGE_SCAN_PROVIDER: "acme" }, {})).toBeNull();
    expect(configuredScanner({ COMMUNITY_IMAGE_SCAN_PROVIDER: "constructor" }, {})).toBeNull();
    expect(configuredScanner({ COMMUNITY_IMAGE_SCAN_PROVIDER: "  " }, {})).toBeNull();
  });
  it("a registered provider named in the environment is used", () => {
    const s = make(async () => "clear");
    expect(configuredScanner({ COMMUNITY_IMAGE_SCAN_PROVIDER: "test" }, { test: s })).toBe(s);
  });
  it("passes a verdict through", async () => {
    expect(await scanPicture(bytes, "image/png", make(async () => "flag"))).toBe("flag");
    expect(await scanPicture(bytes, "image/png", make(async () => "clear"))).toBe("clear");
  });
  it("a provider that throws or returns anything else is unavailable, never a verdict", async () => {
    expect(await scanPicture(bytes, "image/png", make(async () => { throw new Error("down"); }))).toBe("unavailable");
    expect(await scanPicture(bytes, "image/png", make((async () => "approve") as unknown as ImageScanner["scan"]))).toBe("unavailable");
  });
  it("a slow provider is cut off and treated as unavailable", async () => {
    jest.useFakeTimers();
    const p = scanPicture(bytes, "image/png", make(() => new Promise(() => undefined)));
    await jest.advanceTimersByTimeAsync(4100);
    expect(await p).toBe("unavailable");
    jest.useRealTimers();
  });
});
