import { describe, expect, it } from "@jest/globals";
import { catalogueLabel, normaliseQuery, prefillFromCatalogue, searchCatalogue, type CatalogueEntry } from "./catalogue";

const e = (id: string, genericName: string, brandName: string | null, strength: string | null = null, form: string | null = null): CatalogueEntry => ({
  id, genericName, brandName, strength, form, nafdacNumber: null, isVerified: false,
});

const LIST = [
  e("1", "Amlodipine", null, "5 mg", "tablet"),
  e("2", "Amlodipine", "Norvasc", "10 mg", "tablet"),
  e("3", "Lisinopril", null, "10 mg", "tablet"),
  e("4", "Metformin", "Glucophage", "500 mg", "tablet"),
  e("5", "Artemether and lumefantrine", "Coartem", "20/120 mg", "tablet"),
];

describe("normaliseQuery", () => {
  it("lowers case, strips accents and punctuation, collapses spaces", () => {
    expect(normaliseQuery("  Amló-DIPINE,  5mg ")).toBe("amlo dipine 5mg");
  });
});

describe("searchCatalogue", () => {
  it("returns nothing under two characters", () => {
    expect(searchCatalogue(LIST, "a")).toEqual([]);
    expect(searchCatalogue(LIST, " ")).toEqual([]);
  });
  it("finds by generic or brand, prefix before word-start before contains", () => {
    expect(searchCatalogue(LIST, "amlo").map((m) => m.entry.id)).toEqual(["1", "2"]);
    expect(searchCatalogue(LIST, "norv").map((m) => m.entry.id)).toEqual(["2"]);
    expect(searchCatalogue(LIST, "lume").map((m) => m.entry.id)).toEqual(["5"]);
    expect(searchCatalogue(LIST, "ormin").map((m) => m.entry.id)).toEqual(["4"]);
  });
  it("ranks an exact name first and breaks ties on shorter then alphabetical", () => {
    const r = searchCatalogue([e("a", "Lisinopril 10", null), e("b", "Lisinopril", null), e("c", "Lisinopril", "Zestril")], "lisinopril");
    expect(r.map((m) => m.entry.id)).toEqual(["b", "c", "a"]);
    expect(r[0].rank).toBe(0);
  });
  it("breaks equal-length ties alphabetically", () => {
    const r2 = searchCatalogue([e("y", "Zink", null), e("x", "Zinc", null)], "zin");
    expect(r2.map((m) => m.entry.id)).toEqual(["x", "y"]);
  });
  it("honours the limit and a zero limit", () => {
    expect(searchCatalogue(LIST, "amlo", 1)).toHaveLength(1);
    expect(searchCatalogue(LIST, "amlo", 0)).toHaveLength(0);
  });
  it("matches a brand when the generic does not, and a generic when the brand is null", () => {
    expect(searchCatalogue([e("g", "Zzz", "Amlotest")], "amlot")).toHaveLength(1);
    expect(searchCatalogue([e("g", "Amlotest", null)], "amlot")).toHaveLength(1);
    expect(searchCatalogue([e("g", "Amlo", "Amlo")], "amlo")[0].rank).toBe(0);
  });
});

describe("prefill and label", () => {
  it("prefills the generic name and keeps every other field for the patient to confirm", () => {
    expect(prefillFromCatalogue(LIST[1])).toEqual({
      drugName: "Amlodipine", strength: "10 mg", form: "tablet", brandName: "Norvasc", nafdacNumber: null, isVerified: false,
    });
  });
  it("labels with brand in brackets only when there is one", () => {
    expect(catalogueLabel(LIST[1])).toBe("Amlodipine 10 mg tablet (Norvasc)");
    expect(catalogueLabel(LIST[0])).toBe("Amlodipine 5 mg tablet");
    expect(catalogueLabel(e("z", "Zinc", null))).toBe("Zinc");
  });
});
