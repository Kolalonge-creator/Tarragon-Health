import { describe, expect, it } from "@jest/globals";
import { editDistanceAtMost, normaliseText, textMatchesAny, textMatchesTerm, tokenise } from "./text-match";

describe("text-match", () => {
  it("normalises case, diacritics and punctuation", () => {
    expect(normaliseText("  PHQ-9, Penicillín!  ")).toBe("phq 9 penicillin");
    expect(tokenise("")).toEqual([]);
  });

  it("matches whole tokens, never substrings", () => {
    expect(textMatchesTerm("Archive of notes", "hiv")).toBe(false);
    expect(textMatchesTerm("Bicycle", "cycle")).toBe(false);
    expect(textMatchesTerm("HIV retest", "hiv")).toBe(true);
    expect(textMatchesTerm("(HIV)", "hiv")).toBe(true);
  });

  it("matches multi-word and hyphenated terms as a run of tokens", () => {
    expect(textMatchesTerm("AUDIT-C score", "audit c")).toBe(true);
    expect(textMatchesTerm("audit then c", "audit c")).toBe(false);
    expect(textMatchesTerm("Hepatitis B vaccine", "hepatitis b")).toBe(true);
  });

  it("a trailing * makes the last word a prefix", () => {
    expect(textMatchesTerm("pregnant", "pregnan*")).toBe(true);
    expect(textMatchesTerm("pregnancy test", "pregnan*")).toBe(true);
    expect(textMatchesTerm("unpregnant", "pregnan*")).toBe(false);
  });

  it("treats a plain plural as the same word, including an aliased one", () => {
    expect(textMatchesTerm("penicillins", "penicillin")).toBe(true);
    expect(textMatchesTerm("sulphonamides", "sulfonamide", { aliases: { sulphonamide: "sulfonamide" } })).toBe(true);
    expect(textMatchesTerm("cats", "cat")).toBe(false);
  });

  it("empty terms never match", () => {
    expect(textMatchesTerm("anything", "")).toBe(false);
    expect(textMatchesAny("anything", ["", "  "])).toBe(false);
  });

  it("allows one typo only in words of six letters or more, only when fuzzy is on", () => {
    expect(textMatchesTerm("amoxicilin", "amoxicillin")).toBe(false);
    expect(textMatchesTerm("amoxicilin", "amoxicillin", { fuzzy: true })).toBe(true);
    expect(textMatchesTerm("sulfo", "sulfa", { fuzzy: true })).toBe(false);
    expect(textMatchesTerm("amoxxcilin", "amoxicillin", { fuzzy: true })).toBe(false);
  });

  it("applies aliases to both sides", () => {
    expect(textMatchesTerm("sulpha", "sulfa", { aliases: { sulpha: "sulfa" } })).toBe(true);
  });

  it("edit distance stops early", () => {
    expect(editDistanceAtMost("abc", "abc", 1)).toBe(0);
    expect(editDistanceAtMost("abc", "abd", 1)).toBe(1);
    expect(editDistanceAtMost("abc", "xyz", 1)).toBeGreaterThan(1);
    expect(editDistanceAtMost("abc", "abcdef", 1)).toBeGreaterThan(1);
  });
});
