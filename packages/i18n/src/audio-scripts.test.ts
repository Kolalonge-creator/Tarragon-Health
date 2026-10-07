import { describe, expect, it } from "@jest/globals";
import { AUDIO_SCRIPTS } from "./audio-scripts";

const BANNED = [/\bcures?\b/i, /\bcured\b/i, /instant doctor/i, /free healthcare/i, /your doctor/i, /—|–/, /\bguaranteed?\b/i, /\be\.g\./i, /\bi\.e\./i];

describe("audio scripts (the words a clip says)", () => {
  const entries = Object.entries(AUDIO_SCRIPTS);

  it("has no empty script", () => {
    expect(entries.length).toBeGreaterThan(150);
    for (const [id, s] of entries) expect([id, s.en.trim() !== ""]).toEqual([id, true]);
  });

  it("contains no banned word, no dash and no abbreviation a voice could misread (list section 3.5)", () => {
    for (const [id, s] of entries) {
      for (const lang of ["en"] as const) {
        for (const re of BANNED) expect([id, lang, re.test(s[lang])]).toEqual([id, lang, false]);
      }
    }
  });

  it("says the emergency number the way the list requires, in words", () => {
    for (const [id, s] of entries) {
      if (id.startsWith("EMG-")) expect([id, /\b112\b/.test(s.en)]).toEqual([id, false]);
    }
    expect(AUDIO_SCRIPTS["EMG-001"].en).toContain("one one two");
  });
});
