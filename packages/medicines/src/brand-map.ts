import type { CatalogueEntry } from "./catalogue";
import { normaliseIngredient } from "./ingredients";

/**
 * Brand-to-generic mapping (S08y, item 3).
 *
 * A brand name is a label for one or more active ingredients. A clinician or pharmacist-governed table records which, with a
 * public citation for every row. It is used for two things only: finding a medicine when someone types the brand, and the
 * duplicate-ingredient check (a brand and a generic that name the same ingredient). It never changes a medicine or a dose.
 *
 * Publish gate (the same idea as S55): a row is USED only when it is active AND carries a named reviewer, a review time, a
 * reviewer's display name and a citation. A draft row, a row whose review was cleared by an edit, and a row without a citation
 * are ignored everywhere. The table ships empty; nothing here invents a mapping.
 */
export interface BrandMapEntry {
  id: string;
  brandName: string;
  /** Generic (INN) ingredient names, one per active ingredient. */
  ingredients: string[];
  /** A public source for the mapping. Must contain an https link, for example a NAFDAC Greenbook or WHO page. */
  sourceCitation: string;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  isActive: boolean;
}

function present(v: string | null): v is string {
  return v !== null && v.trim().length > 0;
}

/** True only for a row that has been through the gate. */
export function isUsableBrandEntry(e: BrandMapEntry): boolean {
  return (
    e.isActive &&
    present(e.reviewedBy) &&
    present(e.reviewerName) &&
    present(e.reviewedAt) &&
    present(e.sourceCitation) &&
    e.ingredients.length > 0
  );
}

export function usableBrandEntries(entries: readonly BrandMapEntry[]): BrandMapEntry[] {
  return entries.filter(isUsableBrandEntry);
}

/**
 * What a typed name stands for. The longest published brand that the name equals, or starts with followed by a space
 * ("Augmentin 625"), wins; then a catalogue brand; otherwise the name itself, taken to be a generic. Returns the generic
 * text the duplicate-ingredient check splits.
 */
export function resolveGeneric(name: string, entries: readonly BrandMapEntry[], catalogue: readonly CatalogueEntry[]): string {
  const n = normaliseIngredient(name);
  const fromMap = longestBrandMatch(
    n,
    usableBrandEntries(entries).map((e) => ({ brand: e.brandName, generic: e.ingredients.join(" and ") })),
  );
  if (fromMap !== null) return fromMap;
  const fromCatalogue = longestBrandMatch(
    n,
    catalogue.filter((c) => c.brandName !== null).map((c) => ({ brand: c.brandName as string, generic: c.genericName })),
  );
  return fromCatalogue ?? name;
}

function longestBrandMatch(normalisedName: string, pairs: { brand: string; generic: string }[]): string | null {
  let bestLen = 0;
  let bestGeneric: string | null = null;
  for (const p of pairs) {
    const b = normaliseIngredient(p.brand);
    if (b.length > bestLen && (normalisedName === b || normalisedName.startsWith(`${b} `))) {
      bestLen = b.length;
      bestGeneric = p.generic;
    }
  }
  return bestGeneric;
}

/** Published brand rows in the shape the add form's search already ranks, so a typed brand finds its generic. */
export function brandEntriesAsCatalogue(entries: readonly BrandMapEntry[]): CatalogueEntry[] {
  return usableBrandEntries(entries).map((e) => ({
    id: `brandmap:${e.id}`,
    brandName: e.brandName,
    genericName: e.ingredients.join(" and "),
    strength: null,
    form: null,
    nafdacNumber: null,
    isVerified: false,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV importer. Pure: it validates text and returns draft rows plus per-line refusals; it writes nothing.
// ---------------------------------------------------------------------------------------------------------------------

export const BRAND_MAP_CSV_HEADER = ["brand_name", "ingredients", "source_citation"] as const;
export const BRAND_MAP_CSV_MAX_ROWS = 500;
const MAX_BRAND = 80;
const MAX_INGREDIENT = 80;
const MAX_CITATION = 400;

export interface BrandMapDraft {
  brandName: string;
  ingredients: string[];
  sourceCitation: string;
}

export type BrandMapCsvError =
  | "empty_file"
  | "bad_header"
  | "too_many_rows"
  | "wrong_column_count"
  | "brand_missing"
  | "brand_too_long"
  | "ingredients_missing"
  | "ingredient_too_long"
  | "citation_missing"
  | "citation_not_a_link"
  | "citation_too_long"
  | "duplicate_brand"
  | "unterminated_quote";

export interface BrandMapCsvResult {
  rows: BrandMapDraft[];
  /** Line numbers are 1-based and count the header line. Line 0 means the file as a whole. */
  errors: { line: number; error: BrandMapCsvError }[];
}

/** Split CSV text into records of cells. Handles quotes, doubled quotes, commas and newlines inside quotes, and CRLF. Null: a quote never closed. */
function parseCsv(text: string): string[][] | null {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      records.push(row);
      row = [];
    } else cell += ch;
  }
  if (inQuotes) return null;
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Validate a CSV of `brand_name,ingredients,source_citation`. Ingredients are separated by a semicolon. Every row needs a
 * citation containing an https link: a mapping nobody can check is not a mapping. A refused line never blocks the others,
 * and an accepted row is only ever a DRAFT: it still needs a named reviewer before it is used.
 */
export function parseBrandMapCsv(text: string): BrandMapCsvResult {
  const out: BrandMapCsvResult = { rows: [], errors: [] };
  const records = parseCsv(text.replace(/^﻿/, ""));
  if (records === null) return { rows: [], errors: [{ line: 0, error: "unterminated_quote" }] };
  if (records.length === 0) return { rows: [], errors: [{ line: 0, error: "empty_file" }] };
  const header = records[0].map((h) => h.trim().toLowerCase());
  if (header.length !== BRAND_MAP_CSV_HEADER.length || header.some((h, i) => h !== BRAND_MAP_CSV_HEADER[i])) {
    return { rows: [], errors: [{ line: 1, error: "bad_header" }] };
  }
  if (records.length - 1 > BRAND_MAP_CSV_MAX_ROWS) return { rows: [], errors: [{ line: 0, error: "too_many_rows" }] };

  const seen = new Set<string>();
  records.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const fail = (error: BrandMapCsvError) => out.errors.push({ line, error });
    if (cells.length !== 3) return fail("wrong_column_count");
    const brandName = cells[0].trim();
    const ingredients = [...new Set(cells[1].split(";").map((s) => s.trim()).filter((s) => s.length > 0))];
    const sourceCitation = cells[2].trim();
    if (brandName.length === 0) return fail("brand_missing");
    if (brandName.length > MAX_BRAND) return fail("brand_too_long");
    if (ingredients.length === 0) return fail("ingredients_missing");
    if (ingredients.some((i) => i.length > MAX_INGREDIENT)) return fail("ingredient_too_long");
    if (sourceCitation.length === 0) return fail("citation_missing");
    if (sourceCitation.length > MAX_CITATION) return fail("citation_too_long");
    if (!/https:\/\/\S+/i.test(sourceCitation)) return fail("citation_not_a_link");
    const key = normaliseIngredient(brandName);
    if (seen.has(key)) return fail("duplicate_brand");
    seen.add(key);
    out.rows.push({ brandName, ingredients, sourceCitation });
  });
  return out;
}
