import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLINICAL_STAFF_COLUMNS_NO_FOLIO, CLINICAL_STAFF_SELECT_NO_FOLIO } from "./staff-columns";

/**
 * The column list the base-table lock grants must cover every generated row column except the folio, so a column added later cannot be
 * forgotten. (The generated types are spliced per branch and can lag the live table, so the list may hold MORE than the types do.)
 */
function generatedRowKeys(): string[] {
  const src = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "packages", "shared", "src", "database.types.ts"), "utf8");
  const start = src.indexOf("      clinical_staff: {");
  const rowStart = src.indexOf("Row: {", start);
  const rowEnd = src.indexOf("        }\n", rowStart);
  return [...src.slice(rowStart, rowEnd).matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]!);
}

describe("CLINICAL_STAFF_COLUMNS_NO_FOLIO", () => {
  it("covers every clinical_staff row-type column except credential_number", () => {
    const keys = generatedRowKeys();
    expect(keys).toContain("credential_number");
    const missing = keys.filter((k) => k !== "credential_number" && !(CLINICAL_STAFF_COLUMNS_NO_FOLIO as readonly string[]).includes(k));
    expect(missing).toEqual([]);
  });
  it("never names the folio and is a comma list", () => {
    expect(CLINICAL_STAFF_SELECT_NO_FOLIO).not.toContain("credential_number");
    expect(CLINICAL_STAFF_SELECT_NO_FOLIO.split(", ").length).toBe(CLINICAL_STAFF_COLUMNS_NO_FOLIO.length);
  });
});
