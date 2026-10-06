import { itemLabel } from "./item-label";

describe("itemLabel", () => {
  it("looks the i18n key up in the patient's language", () => {
    expect(itemLabel("catalog.membership_annual.name", "x", "en")).toBe("Tarragon Membership");
  });
  it("falls back, never showing a raw key, for a key this build does not know or no key at all", () => {
    expect(itemLabel("catalog.nope.name", "care_pack")).toBe("care_pack");
    expect(itemLabel(null, "membership")).toBe("membership");
    expect(itemLabel(undefined, "membership")).toBe("membership");
  });
});
