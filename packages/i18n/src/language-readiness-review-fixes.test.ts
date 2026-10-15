import { describe, expect, it } from "@jest/globals";
import { checkLanguageGate, clipPairing, parseLanguageRegistry, type ManifestClip } from "./language-readiness";

/** Regression tests for the S86 code-review findings (blank checksum pairs, vacuous empty feature, silent coercion in the parser). */
const clip = (over: Partial<ManifestClip["files"][string] & object>): ManifestClip => ({
  id: "X-1", group: "X", clinical: false, legal: false, script_hash: "h",
  files: { en: { sha256: "abc", bytes: 10, approvals: [{ review: "brand", sha256: "abc" }], ...over } },
});

describe("clipPairing", () => {
  it("pairs a recorded, signed clip", () => expect(clipPairing(clip({}), "en", "en").paired).toBe(true));
  it("does not pair a blank checksum even when an approval is also blank", () => {
    const r = clipPairing(clip({ sha256: "", approvals: [{ review: "brand", sha256: "" }] }), "en", "en");
    expect(r).toEqual({ paired: false, reason: "not_recorded" });
  });
  it("does not pair a clip with no byte count", () => {
    expect(clipPairing(clip({ bytes: undefined }), "en", "en").reason).toBe("not_recorded");
    expect(clipPairing(clip({ bytes: 0 }), "en", "en").reason).toBe("not_recorded");
  });
});

const base = () => ({
  source_language: "en",
  features: { f: { message_prefixes: ["f."], audio_groups: [], clinical: false } },
  languages: { en: { status: "clinician_signed", source: true, enabled_for: ["f"], native_review: {}, clinician_signoff: {} } },
});

describe("parseLanguageRegistry strictness", () => {
  it("accepts a valid registry", () => expect(() => parseLanguageRegistry(base())).not.toThrow());
  it("rejects a non-string prefix, enabled_for entry, or a fractional sign-off version", () => {
    const a = base(); (a.features.f.message_prefixes as unknown[]).push(7);
    expect(() => parseLanguageRegistry(a)).toThrow(/strings/);
    const b = base(); (b.languages.en.enabled_for as unknown[]).push(true);
    expect(() => parseLanguageRegistry(b)).toThrow(/strings/);
    const c = base() as Record<string, unknown>;
    (c.languages as Record<string, Record<string, unknown>>).en.native_review = { f: { by: "x", on: "2026-01-01", version: 1.5, set_hash: "h" } };
    expect(() => parseLanguageRegistry(c)).toThrow(/malformed/);
  });
});

describe("gate on an empty feature", () => {
  it("refuses to enable a language for a feature that owns no source key", () => {
    const reg = parseLanguageRegistry({
      ...base(),
      features: { f: { message_prefixes: ["nothing."], audio_groups: [], clinical: false } },
      languages: {
        en: { status: "clinician_signed", source: true, enabled_for: ["f"], native_review: {}, clinician_signoff: {} },
        xx: { status: "native_reviewed", enabled_for: ["f"], native_review: {}, clinician_signoff: {} },
      },
    });
    const codes = checkLanguageGate({ registry: reg, catalogues: { en: { "a.b": "x" }, xx: {} }, manifest: { clips: [] } }).map((v) => v.code);
    expect(codes).toContain("feature_empty");
  });
});
