import { describe, expect, it } from "@jest/globals";
import { pickRedirectTarget, sanitizeRedirect } from "./redirect";

describe("sanitizeRedirect", () => {
  it("keeps a same-origin path, query and fragment", () => {
    expect(sanitizeRedirect("/ngo")).toBe("/ngo");
    expect(sanitizeRedirect("/patient/vitals?tab=bp#top")).toBe("/patient/vitals?tab=bp#top");
  });

  it("rejects empty, absolute and protocol-relative targets", () => {
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "evil.example", "javascript:alert(1)"]) {
      expect(sanitizeRedirect(bad)).toBeNull();
    }
  });

  it("rejects a backslash, which browsers read as a forward slash", () => {
    expect(sanitizeRedirect("/\\evil.example")).toBeNull();
    expect(sanitizeRedirect("/ok\\..\\evil")).toBeNull();
  });

  it("rejects control characters browsers strip while parsing", () => {
    expect(sanitizeRedirect("/\t/evil.example")).toBeNull();
    expect(sanitizeRedirect("/\n/evil.example")).toBeNull();
    expect(sanitizeRedirect("/ok\r")).toBeNull();
  });
});

describe("pickRedirectTarget (OQ-336: a signed document link survives login through `next`)", () => {
  it("honours a valid next, including the signed document path with its query", () => {
    const link = "/d/care-plan/abc?e=1760000000&s=deadbeef";
    expect(pickRedirectTarget({ next: link })).toBe(link);
  });
  it("prefers redirect when both are valid, and falls back to next when redirect is unsafe", () => {
    expect(pickRedirectTarget({ redirect: "/patient", next: "/d/x/y" })).toBe("/patient");
    expect(pickRedirectTarget({ redirect: "//evil.example", next: "/d/x/y" })).toBe("/d/x/y");
  });
  it("rejects every open-redirect shape in next: absolute, protocol-relative, backslash, control characters, scheme tricks", () => {
    for (const bad of ["https://evil.example/d/x/y", "//evil.example", "/\\evil.example", "/\t/evil.example", "/ok\r\nLocation: x", "javascript:alert(1)", "d/x/y", "", "%2f%2fevil.example"]) {
      expect(pickRedirectTarget({ next: bad })).toBeNull();
    }
  });
  it("takes the first value of a repeated parameter and ignores absent ones", () => {
    expect(pickRedirectTarget({ next: ["/d/a/b", "https://evil.example"] })).toBe("/d/a/b");
    expect(pickRedirectTarget({ next: ["https://evil.example", "/d/a/b"] })).toBeNull();
    expect(pickRedirectTarget({})).toBeNull();
  });
});
