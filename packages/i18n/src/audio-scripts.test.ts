import { activeWording } from "./clinical-wording";
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
    // EMG-001 names the number only if the wording in force does (the screen prints no number until the CMO confirms 112).
    const onScreen = /\b112\b/.test(activeWording("EMG-001").body);
    expect(AUDIO_SCRIPTS["EMG-001"].en.includes("one one two")).toBe(onScreen);
  });
});
