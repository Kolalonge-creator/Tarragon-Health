import { asUiLanguage, DEFAULT_UI_LANGUAGE, t } from "./ui-language";

describe("ui language", () => {
  it("defaults to English, including for junk and nulls", () => {
    expect(DEFAULT_UI_LANGUAGE).toBe("en");
    expect(asUiLanguage(null)).toBe("en");
    expect(asUiLanguage(undefined)).toBe("en");
    expect(asUiLanguage("yo")).toBe("en");
    expect(asUiLanguage("pcm")).toBe("pcm");
  });

  it("returns English untouched when English is selected", () => {
    expect(t("Medications", "en")).toBe("Medications");
  });

  it("translates the everyday navigation", () => {
    expect(t("Medications", "pcm")).toBe("Your medicine");
    expect(t("Labs & results", "pcm")).toBe("Test results");
  });

  it("degrades an untranslated string to readable English, never a key", () => {
    // A nav item added by somebody who never read the dictionary must render
    // as English, not as a broken label.
    expect(t("Some Brand New Section", "pcm")).toBe("Some Brand New Section");
  });

  it("carries no clinical, emergency, dosing or consent string", () => {
    // The boundary in ui-language.ts is the point of the whole file: a
    // half-translated safety instruction is worse than an untranslated one,
    // because the patient cannot tell which half they are reading. This test
    // is what stops that boundary eroding one well-meaning string at a time.
    const forbidden = [
      "Feeling something serious right now?",
      "Get emergency guidance",
      "A low is below",
      "Go to the nearest hospital now",
      "Crisis range",
      "mg/dL",
      "mmol/L",
    ];
    for (const phrase of forbidden) {
      expect(t(phrase, "pcm")).toBe(phrase);
    }
  });
});
