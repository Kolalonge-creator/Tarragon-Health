import WORDING from "./clinical-wording.json";
import {
  activeFertileWindowWording,
  FERTILE_WINDOW_BANNED_PHRASES,
  FERTILE_WINDOW_LABEL,
  FERTILE_WINDOW_LINK_TEXT,
  FERTILE_WINDOW_SIGNED,
} from "./clinical-wording";
import { en } from "./en";

describe("fertile window label (S85 D2, OQ-12)", () => {
  const EXACT_LABEL = "Not contraception. This cannot prevent pregnancy.";
  const EXACT_LINK = "Learn about contraception and talk to your care team.";

  it("carries the founder's exact words, with and without a CMO signature", () => {
    const signed = { by: "test", on: "2026-10-07", version: 1 };
    for (const s of [null, signed]) {
      expect(activeFertileWindowWording(s).label).toBe(EXACT_LABEL);
      expect(activeFertileWindowWording(s).link).toBe(EXACT_LINK);
    }
    expect(FERTILE_WINDOW_LABEL).toBe(EXACT_LABEL);
    expect(FERTILE_WINDOW_LINK_TEXT).toBe(EXACT_LINK);
  });

  it("is NOT signed by this build: a signature is a CMO act and only a person adds it", () => {
    expect(FERTILE_WINDOW_SIGNED).toBeNull();
    expect(WORDING.fertileWindow.signed).toBeNull();
  });

  it("unsigned means the interim text, signed means the proposal", () => {
    expect(activeFertileWindowWording(null)).toEqual(WORDING.fertileWindow.current);
    expect(activeFertileWindowWording({ by: "x", on: "2026-10-07", version: 1 })).toEqual(WORDING.fertileWindow.proposed);
  });

  it("is the same text in the catalogue", () => {
    expect(en["cycle.fertile_window.label"]).toBe(FERTILE_WINDOW_LABEL);
    expect(en["cycle.fertile_window.link"]).toBe(FERTILE_WINDOW_LINK_TEXT);
    expect(en["cycle.planning_mode.title"]).toBe("Planning a pregnancy");
  });

  it("never uses the banned wording or an em dash or 'your doctor' in any new string", () => {
    const strings = Object.entries(en)
      .filter(([k]) => k.startsWith("cycle."))
      .map(([, v]) => v);
    expect(strings.length).toBeGreaterThan(5);
    for (const text of strings) {
      for (const banned of FERTILE_WINDOW_BANNED_PHRASES) expect(text.toLowerCase()).not.toContain(banned);
      expect(text).not.toMatch(/—|your doctor/i);
    }
  });
});
