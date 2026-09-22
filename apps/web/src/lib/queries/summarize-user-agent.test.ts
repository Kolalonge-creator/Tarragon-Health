import { describe, expect, it } from "@jest/globals";
import { summarizeUserAgent } from "./summarize-user-agent";

describe("summarizeUserAgent", () => {
  it("returns a placeholder for a missing User-Agent", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
  });

  it("identifies Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    expect(summarizeUserAgent(ua)).toBe("Chrome on Windows");
  });

  it("identifies Safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(summarizeUserAgent(ua)).toBe("Safari on iOS");
  });

  it("identifies Chrome on Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
    expect(summarizeUserAgent(ua)).toBe("Chrome on Android");
  });

  it("falls back to a truncated raw string for anything unrecognised", () => {
    const ua = "SomeWeirdClient/1.0 doing its own thing with a very long descriptive string here";
    expect(summarizeUserAgent(ua)).toBe(`${ua.slice(0, 60)}…`);
  });
});
