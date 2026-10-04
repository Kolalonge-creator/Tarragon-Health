import { describe, expect, it } from "@jest/globals";
import { sanitizeRedirect } from "./redirect";

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
