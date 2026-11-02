import { describe, expect, it } from "@jest/globals";
import { clientIp, hashSecret, isAllowedOrigin, isJson, newConversationSecret } from "./chat-http";

describe("conversation secret", () => {
  it("is random, long, URL safe, and hashes to a stable 64 character value", () => {
    const a = newConversationSecret();
    const b = newConversationSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(a)).toBe(hashSecret(a));
    expect(hashSecret(a)).not.toBe(hashSecret(b));
  });
});

describe("isAllowedOrigin", () => {
  it("allows this site's own origin", () => {
    expect(isAllowedOrigin("https://tarragonhealth.ng", "tarragonhealth.ng", undefined)).toBe(true);
  });
  it("allows an origin on the configured list and nothing else", () => {
    expect(isAllowedOrigin("https://partner.example", "tarragonhealth.ng", "https://partner.example, https://x.example")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", "tarragonhealth.ng", "https://partner.example")).toBe(false);
  });
  it("refuses a missing Origin, a malformed one, and plain http (except localhost)", () => {
    expect(isAllowedOrigin(null, "tarragonhealth.ng", undefined)).toBe(false);
    expect(isAllowedOrigin("not a url", "tarragonhealth.ng", undefined)).toBe(false);
    expect(isAllowedOrigin("http://tarragonhealth.ng", "tarragonhealth.ng", undefined)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", "localhost:3000", undefined)).toBe(true);
  });
  it("does not accept a lookalike host", () => {
    expect(isAllowedOrigin("https://tarragonhealth.ng.evil.example", "tarragonhealth.ng", undefined)).toBe(false);
  });
});

describe("request helpers", () => {
  it("prefers the platform's header for the client IP", () => {
    const h = new Headers({ "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.1", "x-forwarded-for": "198.51.100.9" });
    expect(clientIp(h)).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.9, 1.1.1.1" }))).toBe("198.51.100.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
  it("recognises a JSON request", () => {
    expect(isJson(new Headers({ "content-type": "application/json; charset=utf-8" }))).toBe(true);
    expect(isJson(new Headers({ "content-type": "text/plain" }))).toBe(false);
  });
});
