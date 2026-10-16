import { describe, expect, it } from "@jest/globals";
import type { CatalogueEntry } from "./catalogue";
import {
  extractNafdacNumbers,
  extractStrengthSuggestion,
  lookupNafdacNumber,
  matchCatalogueNamesInText,
  normaliseNafdacNumber,
  NAFDAC_NUMBER_CONFIG,
} from "./nafdac-number";

const entry = (over: Partial<CatalogueEntry>): CatalogueEntry => ({
  id: "x",
  brandName: null,
  genericName: "Amlodipine",
  strength: "5 mg",
  form: "tablet",
  nafdacNumber: "A4-1234",
  isVerified: true,
  ...over,
});

describe("normaliseNafdacNumber (typed entry, works offline)", () => {
  it.each([
    ["A4-1234", "A4-1234"],
    ["a4-1234", "A4-1234"],
    ["04-1234", "04-1234"],
    ["B4-0123", "B4-0123"],
    ["A11-101363", "A11-101363"],
    ["A4 - 1234", "A4-1234"],
    ["A4–1234", "A4-1234"],
    ["A4−1234", "A4-1234"],
    ["NAFDAC Reg. No. A4-1234", "A4-1234"],
    ["NAFDAC REG NO: 04-5678", "04-5678"],
    ["A4-1234L", "A4-1234L"],
  ])("accepts %s", (raw, value) => {
    expect(normaliseNafdacNumber(raw)).toEqual({ value, ocrCorrected: false });
  });

  it.each([
    ["O4-1234", "04-1234"],
    ["A4-12O4", "A4-1204"],
    ["A4-l234", "A4-1234"],
    ["IO-1234", "10-1234"],
    ["A4-12I4B", "A4-1214B"],
  ])("fixes look-alike characters in %s and says it did", (raw, value) => {
    expect(normaliseNafdacNumber(raw)).toEqual({ value, ocrCorrected: true });
  });

  it.each([[""], ["hello"], ["A4"], ["A4-12"], ["A4-1234567"], ["AB4-1234"], ["A4-12-34"], ["A4-ABCD"], ["1234"], ["A4-"], ["-1234"]])("rejects %j", (raw) => {
    expect(normaliseNafdacNumber(raw)).toBeNull();
  });

  it("truncates a very long input instead of scanning it all", () => {
    expect(normaliseNafdacNumber("A4-1234" + " x".repeat(5000))).toBeNull();
  });
});

describe("extractNafdacNumbers (text a phone read off a pack)", () => {
  it("finds a labelled number and marks it labelled", () => {
    expect(extractNafdacNumbers(["Amlodipine 5mg", "NAFDAC Reg. No.: A4-1234", "Batch 22"])).toEqual([{ value: "A4-1234", ocrCorrected: false, source: "labelled" }]);
  });
  it("finds labels split across forms: NAFDAC A4-1234 and NAFDAC No 04-5678", () => {
    const got = extractNafdacNumbers(["NAFDAC A4-1234", "nafdac no 04-5678"]);
    expect(got.map((g) => [g.value, g.source])).toEqual([
      ["A4-1234", "labelled"],
      ["04-5678", "labelled"],
    ]);
  });
  it("finds an unlabelled letter-prefixed number", () => {
    expect(extractNafdacNumbers(["B4-0456"])).toEqual([{ value: "B4-0456", ocrCorrected: false, source: "unlabelled" }]);
  });
  it("does not report the same number twice", () => {
    expect(extractNafdacNumbers(["NAFDAC Reg No A4-1234", "A4-1234"])).toHaveLength(1);
  });
  it("drops an unlabelled month-year expiry such as 10-2027", () => {
    expect(extractNafdacNumbers(["EXP 10-2027", "MFG 03-2025"])).toEqual([]);
  });
  it("keeps a month-year-shaped number when the pack labels it", () => {
    expect(extractNafdacNumbers(["NAFDAC Reg. No. 04-2027"])[0]).toMatchObject({ value: "04-2027", source: "labelled" });
  });
  it("copes with OCR noise: look-alikes, stray symbols, lower case", () => {
    const got = extractNafdacNumbers(["~~ nafdac reg. no. a4-l2O4 ~~"]);
    expect(got[0]).toEqual({ value: "A4-1204", ocrCorrected: true, source: "labelled" });
  });
  it("does not offer a batch, lot or manufacture number", () => {
    expect(extractNafdacNumbers(["Batch No: B1-123456", "LOT A4-5678", "mfg. 04-5678"])).toEqual([]);
  });
  it("does not guess at an unlabelled number that needed look-alike repair", () => {
    expect(extractNafdacNumbers(["OIL-1000", "A4-12O4"])).toEqual([]);
  });
  it("returns nothing for text with no number, for empty input and for garbage", () => {
    expect(extractNafdacNumbers([])).toEqual([]);
    expect(extractNafdacNumbers(["", "   "])).toEqual([]);
    expect(extractNafdacNumbers(["@@@ ### !!! 12 34", "lorem ipsum"])).toEqual([]);
  });
  it("only scans up to the configured length", () => {
    const cfg = { ...NAFDAC_NUMBER_CONFIG, maxTextLength: 10 };
    expect(extractNafdacNumbers(["xxxxxxxxxxxxxxxxxxxx A4-1234"], cfg)).toEqual([]);
  });
});

describe("extractStrengthSuggestion", () => {
  it.each([
    [["Amlodipine 5mg tablets"], "5 mg"],
    [["500 MG"], "500 mg"],
    [["Each 5 ml contains 250mg/5ml"], "5 ml"],
    [["250 mg/5 ml suspension"], "250 mg/5 ml"],
    [["250mg/ml"], "250 mg/ml"],
    [["2,5 g"], "2.5 g"],
    [["100 mcg"], "100 mcg"],
    [["100 µg"], "100 mcg"],
    [["100 ug"], "100 mcg"],
    [["1000 iu"], "1000 IU"],
    [["1,5mg/2,5ml"], "1.5 mg/2.5 ml"],
    [["Metformin 1,000 mg"], "1000 mg"],
    [["28 gastro-resistant tablets", "Pantoprazole 40 mg"], "40 mg"],
    [["30 Gelcaps", "100 grams", "5 IUs"], null],
  ])("%j gives %s", (lines, want) => {
    expect(extractStrengthSuggestion(lines)).toBe(want);
  });
  it("is null when no strength is printed", () => {
    expect(extractStrengthSuggestion(["Take with water", "A4-1234"])).toBeNull();
  });
});

describe("matchCatalogueNamesInText", () => {
  const cat = [
    entry({ id: "1", genericName: "Amlodipine", brandName: "Norvasc" }),
    entry({ id: "2", genericName: "Metformin", brandName: null }),
    entry({ id: "3", genericName: "ORS", brandName: null }),
    entry({ id: "4", genericName: "Co-trimoxazole", brandName: "Septrin Forte" }),
  ];
  it("matches a generic or brand name printed on the pack", () => {
    expect(matchCatalogueNamesInText(["NORVASC 5mg"], cat).map((e) => e.id)).toEqual(["1"]);
    expect(matchCatalogueNamesInText(["Metformin Hydrochloride"], cat).map((e) => e.id)).toEqual(["2"]);
  });
  it("needs every word of a multi-word name", () => {
    expect(matchCatalogueNamesInText(["Septrin"], cat)).toEqual([]);
    expect(matchCatalogueNamesInText(["Septrin Forte"], cat).map((e) => e.id)).toEqual(["4"]);
  });
  it("ignores names shorter than four letters and empty names", () => {
    expect(matchCatalogueNamesInText(["ORS sachet"], cat)).toEqual([]);
    expect(matchCatalogueNamesInText(["anything"], [entry({ genericName: "", brandName: null })])).toEqual([]);
  });
  it("lists one suggestion per medicine name, not one per strength", () => {
    const rows = [entry({ id: "a" }), entry({ id: "b", strength: "10 mg" })];
    expect(matchCatalogueNamesInText(["Amlodipine"], rows).map((e) => e.id)).toEqual(["a"]);
  });
  it("respects the limit", () => {
    expect(matchCatalogueNamesInText(["Norvasc Metformin"], cat, undefined, 1)).toHaveLength(1);
  });
});

describe("lookupNafdacNumber", () => {
  it("found and verified: pre-fills name, strength and brand from the single row", () => {
    const r = lookupNafdacNumber("a4 - 1234", [entry({ brandName: "Norvasc" })]);
    expect(r).toMatchObject({ kind: "in_catalogue", prefill: { drugName: "Amlodipine", strength: "5 mg", brandName: "Norvasc" } });
  });
  it("is not fooled by punctuation differences on the catalogue side", () => {
    expect(lookupNafdacNumber("A4-1234", [entry({ nafdacNumber: "a4 1234" })]).kind).toBe("in_catalogue");
  });
  it("two rows with one generic: name pre-filled, strength and brand left for the patient", () => {
    const r = lookupNafdacNumber("A4-1234", [entry({ id: "a" }), entry({ id: "b", strength: "10 mg" })]);
    expect(r).toMatchObject({ kind: "in_catalogue", prefill: { drugName: "Amlodipine", strength: null, brandName: null } });
  });
  it("two rows with different generics: nothing pre-filled", () => {
    const r = lookupNafdacNumber("A4-1234", [entry({ id: "a" }), entry({ id: "b", genericName: "Lisinopril" })]);
    expect(r).toMatchObject({ kind: "in_catalogue", prefill: { drugName: null } });
  });
  it("a row that is not verified is not a match and pre-fills nothing", () => {
    expect(lookupNafdacNumber("A4-1234", [entry({ isVerified: false })])).toEqual({ kind: "not_matched" });
  });
  it("a row with no recorded number never matches", () => {
    expect(lookupNafdacNumber("A4-1234", [entry({ nafdacNumber: null })])).toEqual({ kind: "not_matched" });
  });
  it("offline with an empty catalogue: not matched, never an error", () => {
    expect(lookupNafdacNumber("A4-1234", [])).toEqual({ kind: "not_matched" });
  });
  it("not shaped like a number: invalid", () => {
    expect(lookupNafdacNumber("banana", [entry({})])).toEqual({ kind: "invalid" });
  });
  it("the result never carries an authenticity verdict", () => {
    const text = JSON.stringify([lookupNafdacNumber("A4-1234", [entry({})]), lookupNafdacNumber("A4-9999", [entry({})])]);
    expect(text).not.toMatch(/genuine|fake|counterfeit|authentic|safe|approved/i);
  });
});
