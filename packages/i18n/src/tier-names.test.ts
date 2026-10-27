import { en } from "./en";

/** W-46: the display names of the two paid tiers. membership_annual includes the yearly blood panel, so it is Membership Plus. */
describe("membership tier display names", () => {
  it("names the panel-included product Membership Plus and the no-panel product Membership", () => {
    expect(en["catalog.membership_annual.name"]).toBe("Membership Plus");
    expect(en["catalog.membership_annual_no_panel.name"]).toBe("Membership");
  });

  it("never calls any catalogue item 'Tarragon Membership' (the old name for the Plus product)", () => {
    const offenders = Object.entries(en).filter(([k, v]) => k.startsWith("catalog.") && /Tarragon Membership/.test(String(v)));
    expect(offenders).toEqual([]);
  });
});
