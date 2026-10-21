/**
 * Barcode helpers (v5 6.4). A printed product code is a GTIN: 8, 12, 13 or 14 digits ending in a check digit.
 * Typing the code and scanning it use the same path, so both go through `normaliseBarcode` first. Mirrors
 * `private.gtin_valid` in the database; the database also refuses to STORE a code that fails.
 */
export function normaliseBarcode(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function isValidGtin(code: string): boolean {
  if (!/^[0-9]+$/.test(code)) return false;
  const len = code.length;
  if (![8, 12, 13, 14].includes(len)) return false;
  let sum = 0;
  for (let i = 1; i < len; i += 1) {
    const digit = Number(code[len - 1 - i]);
    sum += digit * (i % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(code[len - 1]);
}

export type BarcodeLookup =
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "found"; code: string; productName: string; brand: string | null; nafdacNumber: string | null; packSizeG: number | null; foodCode: string; foodName: string };

/** Reads the JSON `lookup_barcode()` returns. Unknown shapes become "not_found" (the safe, honest answer). */
export function parseBarcodeLookup(raw: unknown): BarcodeLookup {
  if (!raw || typeof raw !== "object") return { status: "not_found" };
  const r = raw as Record<string, unknown>;
  if (r.status === "invalid") return { status: "invalid" };
  if (r.status !== "found" || typeof r.code !== "string" || typeof r.food_code !== "string") return { status: "not_found" };
  return {
    status: "found",
    code: r.code,
    productName: typeof r.product_name === "string" ? r.product_name : "",
    brand: typeof r.brand === "string" ? r.brand : null,
    nafdacNumber: typeof r.nafdac_number === "string" ? r.nafdac_number : null,
    packSizeG: typeof r.pack_size_g === "number" ? r.pack_size_g : null,
    foodCode: r.food_code,
    foodName: typeof r.food_name === "string" ? r.food_name : "",
  };
}
