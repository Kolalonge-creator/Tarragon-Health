import { describe, expect, it } from "@jest/globals";
import {
  BRAND_MAP_CSV_MAX_ROWS,
  brandEntriesAsCatalogue,
  isUsableBrandEntry,
  parseBrandMapCsv,
  resolveGeneric,
  usableBrandEntries,
  type BrandMapEntry,
} from "./brand-map";
import type { CatalogueEntry } from "./catalogue";

const entry = (over: Partial<BrandMapEntry> = {}): BrandMapEntry => ({
  id: "1",
  brandName: "Examplebrand",
  ingredients: ["exampleone", "exampletwo"],
  sourceCitation: "https://example.org/greenbook",
  reviewedBy: "u1",
  reviewerName: "A Pharmacist",
  reviewedAt: "2026-10-20T10:00:00Z",
  isActive: true,
  ...over,
});
const cat = (brandName: string | null, genericName: string): CatalogueEntry => ({
  id: "c", brandName, genericName, strength: null, form: null, nafdacNumber: null, isVerified: false,
});

describe("publish gate", () => {
  it("uses only an active, reviewed, cited row", () => {
    expect(isUsableBrandEntry(entry())).toBe(true);
    expect(isUsableBrandEntry(entry({ isActive: false }))).toBe(false);
    expect(isUsableBrandEntry(entry({ reviewedBy: null }))).toBe(false);
    expect(isUsableBrandEntry(entry({ reviewerName: "  " }))).toBe(false);
    expect(isUsableBrandEntry(entry({ reviewedAt: null }))).toBe(false);
    expect(isUsableBrandEntry(entry({ sourceCitation: "" }))).toBe(false);
    expect(isUsableBrandEntry(entry({ ingredients: [] }))).toBe(false);
    expect(usableBrandEntries([entry(), entry({ id: "2", reviewedBy: null })]).map((e) => e.id)).toEqual(["1"]);
  });
});

describe("resolveGeneric", () => {
  it("prefers a published brand, longest match first, including a trailing strength", () => {
    const entries = [entry(), entry({ id: "2", brandName: "Examplebrand Plus", ingredients: ["other"] })];
    expect(resolveGeneric("examplebrand", entries, [])).toBe("exampleone and exampletwo");
    expect(resolveGeneric("Examplebrand 625", entries, [])).toBe("exampleone and exampletwo");
    expect(resolveGeneric("Examplebrand Plus 10", entries, [])).toBe("other");
  });
  it("ignores an unreviewed row, then falls back to a catalogue brand, then the typed name", () => {
    const draft = entry({ reviewedBy: null });
    expect(resolveGeneric("Examplebrand", [draft], [cat("Examplebrand", "Fromcatalogue")])).toBe("Fromcatalogue");
    expect(resolveGeneric("Examplebrandx", [draft], [cat("Examplebrand", "Fromcatalogue"), cat(null, "Nobrand")])).toBe("Examplebrandx");
    expect(resolveGeneric("", [entry({ brandName: "  " })], [])).toBe("");
  });
});

describe("brandEntriesAsCatalogue", () => {
  it("offers only published rows to the search", () => {
    const out = brandEntriesAsCatalogue([entry(), entry({ id: "2", isActive: false })]);
    expect(out).toEqual([
      { id: "brandmap:1", brandName: "Examplebrand", genericName: "exampleone and exampletwo", strength: null, form: null, nafdacNumber: null, isVerified: false },
    ]);
  });
});

describe("parseBrandMapCsv", () => {
  const head = "brand_name,ingredients,source_citation\n";
  it("accepts good rows, quotes, CRLF, a BOM and repeated ingredients", () => {
    const r = parseBrandMapCsv(
      `﻿Brand_Name, Ingredients ,source_citation\r\nAlpha,one;two;one,"NAFDAC, see https://example.org/a"\r\n\r\n"Be""ta","x",https://example.org/b`,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { brandName: "Alpha", ingredients: ["one", "two"], sourceCitation: "NAFDAC, see https://example.org/a" },
      { brandName: 'Be"ta', ingredients: ["x"], sourceCitation: "https://example.org/b" },
    ]);
  });
  it("handles a newline inside quotes", () => {
    const r = parseBrandMapCsv(`${head}A,"x",https://example.org/a\nB,"y\nz",https://example.org/b`);
    expect(r.rows[1].ingredients).toEqual(["y\nz"]);
  });
  it("refuses whole-file problems", () => {
    expect(parseBrandMapCsv("")).toEqual({ rows: [], errors: [{ line: 0, error: "empty_file" }] });
    expect(parseBrandMapCsv("\n\n")).toEqual({ rows: [], errors: [{ line: 0, error: "empty_file" }] });
    expect(parseBrandMapCsv("a,b,c\n1,2,3").errors).toEqual([{ line: 1, error: "bad_header" }]);
    expect(parseBrandMapCsv("brand_name,ingredients\n").errors).toEqual([{ line: 1, error: "bad_header" }]);
    expect(parseBrandMapCsv(`${head}A,"x,https://example.org`).errors).toEqual([{ line: 0, error: "unterminated_quote" }]);
    const many = head + Array.from({ length: BRAND_MAP_CSV_MAX_ROWS + 1 }, (_, i) => `B${i},x,https://e.org`).join("\n");
    expect(parseBrandMapCsv(many).errors).toEqual([{ line: 0, error: "too_many_rows" }]);
  });
  it("refuses single lines without blocking the rest", () => {
    const long = "x".repeat(81);
    const r = parseBrandMapCsv(
      [
        "brand_name,ingredients,source_citation",
        "A,x",
        ",x,https://e.org",
        `${long},x,https://e.org`,
        "C,,https://e.org",
        `D,${long},https://e.org`,
        "E,x,",
        "F,x,no link here",
        `G,x,https://e.org/${"y".repeat(400)}`,
        "H,x,https://e.org",
        "h,y,https://e.org",
      ].join("\n"),
    );
    expect(r.errors.map((e) => `${e.line}:${e.error}`)).toEqual([
      "2:wrong_column_count",
      "3:brand_missing",
      "4:brand_too_long",
      "5:ingredients_missing",
      "6:ingredient_too_long",
      "7:citation_missing",
      "8:citation_not_a_link",
      "9:citation_too_long",
      "11:duplicate_brand",
    ]);
    expect(r.rows.map((x) => x.brandName)).toEqual(["H"]);
  });
});
