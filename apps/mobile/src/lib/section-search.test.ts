import { SECTIONS, type SectionId } from "./sections";
import { SECTION_KEYWORDS, searchSections } from "./section-search";

const all = SECTIONS.map((s) => s.id);
const ids = (q: string, visible: readonly SectionId[] = all) => searchSections(visible, q, (l) => l).map((m) => m.id);

describe("searchSections", () => {
  it("finds a section by the word a person would type", () => {
    expect(ids("tablets")[0]).toBe("medications");
    expect(ids("sugar")).toContain("vitals");
    expect(ids("period")[0]).toBe("womensHealth");
  });
  it("matches the label first and needs every word to match", () => {
    expect(ids("labs")[0]).toBe("labs");
    expect(ids("blood zzzz")).toEqual([]);
  });
  it("an empty query matches nothing, and a hidden section is never offered", () => {
    expect(ids("")).toEqual([]);
    expect(ids("tablets", all.filter((id) => id !== "medications"))).not.toContain("medications");
  });
  it("never offers Overview", () => {
    expect(ids("overview")).not.toContain("overview");
  });
  it("every keyword entry names a real section (no dead entries)", () => {
    for (const id of Object.keys(SECTION_KEYWORDS)) expect(all).toContain(id);
  });
});
