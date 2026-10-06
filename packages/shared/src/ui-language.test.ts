import { DEFAULT_UI_LANGUAGE, t } from "./ui-language";

describe("ui language (English only)", () => {
  it("is English", () => {
    expect(DEFAULT_UI_LANGUAGE).toBe("en");
  });

  it("returns the English string untouched", () => {
    expect(t("Medications", "en")).toBe("Medications");
    expect(t("Some Brand New Section")).toBe("Some Brand New Section");
  });
});
