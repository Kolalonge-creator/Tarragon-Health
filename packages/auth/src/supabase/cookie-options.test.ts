import { afterEach, describe, expect, it } from "@jest/globals";
import { sessionCookieOptions } from "./cookie-options";

describe("sessionCookieOptions (security audit 2026-11-05, M-6)", () => {
  const original = process.env.VERCEL;
  afterEach(() => {
    if (original === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original;
  });

  it("marks the cookie Secure on a Vercel deployment", () => {
    process.env.VERCEL = "1";
    expect(sessionCookieOptions()).toEqual({ secure: true });
  });

  it("leaves it off for a local server on plain http", () => {
    delete process.env.VERCEL;
    expect(sessionCookieOptions()).toEqual({ secure: false });
  });

  it("never sets a cookie domain", () => {
    process.env.VERCEL = "1";
    expect(sessionCookieOptions()).not.toHaveProperty("domain");
  });
});
