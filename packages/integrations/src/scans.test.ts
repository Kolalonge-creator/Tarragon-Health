import { describe, expect, it } from "@jest/globals";
import { createZoomVideo, isEmailShape, stripTags, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

describe("isEmailShape", () => {
  it("accepts ordinary addresses", () => {
    for (const a of ["a@example.com", "ada.okafor+tag@mail.example.co.ng", "x@y.zz"]) expect(isEmailShape(a)).toBe(true);
  });

  it("rejects the shapes the old pattern rejected", () => {
    for (const a of ["", "nope", "@example.com", "a@", "a@b", "a@b.", "a@.b", "a b@example.com", "a@exa mple.com", "a@@example.com", "a@b@example.com", "a@example.com\n", "a\u0000@example.com"]) {
      expect(isEmailShape(a)).toBe(false);
    }
    expect(isEmailShape(42)).toBe(false);
    expect(isEmailShape(`${"a".repeat(250)}@b.cc`)).toBe(false);
  });

  it("stays fast on a hostile string (linear, not polynomial)", () => {
    const hostile = `a@${"!.".repeat(50_000)}`;
    const start = Date.now();
    isEmailShape(hostile);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe("stripTags", () => {
  it("replaces each tag with a space and keeps the text", () => {
    expect(stripTags('<p class="result reading">Open the app.</p>').replace(/\s+/g, " ").trim()).toBe("Open the app.");
    expect(stripTags("a<b>c</b>d")).toBe("a c d");
    expect(stripTags("no tags")).toBe("no tags");
    expect(stripTags("")).toBe("");
  });

  it("keeps an unmatched angle bracket as text, like the old pattern", () => {
    expect(stripTags("1 < 2 and more")).toBe("1 < 2 and more");
    expect(stripTags("a<b>c<d")).toBe("a c<d");
    expect(stripTags("<<a>x")).toBe(" x");
  });

  it("stays fast on a hostile string (linear, not polynomial)", () => {
    const hostile = "<".repeat(100_000);
    const start = Date.now();
    stripTags(hostile);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe("zoom adapter with the real clock", () => {
  it("uses Date.now when no clock is given", async () => {
    const f: FetchLike = async (u) => ({ status: 200, ok: true, text: async () => (u.includes("oauth") ? '{"access_token":"t","expires_in":3600}' : '{"id":81000000001}') });
    const z = createZoomVideo({ accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "s", fetch: f });
    const r = await z.createRoom({ encounterRef: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44", expiresAtMs: Date.now() + 600_000 });
    expect(r.ok && r.data.roomId).toBe("81000000001");
    const off = z.subscribe("81000000001", () => undefined);
    off();
  });
});
