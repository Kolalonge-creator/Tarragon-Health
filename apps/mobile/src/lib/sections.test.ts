import { MAX_PRIMARY_SECTIONS, PRIMARY_SECTIONS, SECTIONS, SUPPORTER_PRIMARY_SECTIONS } from "./sections";

describe("patient bottom tabs (PD-01)", () => {
  it("are Home, My Health, Messages, Care plan, in that order", () => {
    expect(PRIMARY_SECTIONS.map((s) => [s.id, s.shortLabel])).toEqual([
      ["overview", "Home"],
      ["myHealth", "My Health"],
      ["messages", "Messages"],
      ["care", "Care plan"],
    ]);
    expect(PRIMARY_SECTIONS.length).toBe(MAX_PRIMARY_SECTIONS);
  });

  it("no longer flags Vitals or Medications as tabs, but keeps them one tap behind More", () => {
    for (const id of ["vitals", "medications"] as const) {
      const s = SECTIONS.find((x) => x.id === id);
      expect(s?.primary).toBeFalsy();
      expect(s?.group).toBe("top");
    }
  });

  it("flags exactly the tabs it shows, so none is silently dropped", () => {
    expect(SECTIONS.filter((s) => s.primary).length).toBe(PRIMARY_SECTIONS.length);
  });

  it("leaves the supporter-only tabs unchanged", () => {
    expect(SUPPORTER_PRIMARY_SECTIONS.map((s) => s.id)).toEqual(["supporting", "messages", "family", "receipts"]);
  });
});
