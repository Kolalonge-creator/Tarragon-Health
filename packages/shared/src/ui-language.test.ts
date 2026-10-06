import { asUiLanguage, DEFAULT_UI_LANGUAGE, t, UI_LANGUAGES } from "./ui-language";

describe("ui language (English only)", () => {
  it("offers only English", () => {
    expect(UI_LANGUAGES).toEqual(["en"]);
    expect(DEFAULT_UI_LANGUAGE).toBe("en");
  });

  it("resolves any stored value, including junk and nulls, to English", () => {
    expect(asUiLanguage(null)).toBe("en");
    expect(asUiLanguage(undefined)).toBe("en");
    expect(asUiLanguage("yo")).toBe("en");
    expect(asUiLanguage("fr")).toBe("en");
  });

  it("returns the English string untouched", () => {
    expect(t("Medications", "en")).toBe("Medications");
    expect(t("Some Brand New Section", "en")).toBe("Some Brand New Section");
  });
});
