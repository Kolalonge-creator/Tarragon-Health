import { IMPORT_COLUMNS, parseCsv, readImport } from "./import-csv";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, doubled quotes, CRLF and a byte-order mark", () => {
    expect(parseCsv('﻿a,b\r\n"1, Admiralty Way","say ""hi"""\n')).toEqual([["a", "b"], ["1, Admiralty Way", 'say "hi"']]);
  });
  it("drops blank lines and keeps a last line with no newline", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("readImport", () => {
  const header = "Trading name,Branch,Facility type,State,Town,Address,Evidence,Investigation IDs,Colour";
  it("maps spreadsheet headings to column keys and reports the ones it ignored", () => {
    const res = readImport(`${header}\nSynlab,Lekki,lab,Lagos,Lekki,1 Admiralty Way,MLSCN list,inv.hba1c;inv.fbc,blue\n`);
    expect(res).toEqual({
      ok: true,
      ignoredHeaders: ["Colour"],
      rows: [{
        trading_name: "Synlab", branch_name: "Lekki", facility_type: "lab", state: "Lagos", town: "Lekki",
        address: "1 Admiralty Way", evidence: "MLSCN list", investigation_codes: "inv.hba1c;inv.fbc",
      }],
    });
  });
  it("refuses a file without the required columns, naming them", () => {
    expect(readImport("Trading name,State\nA,Lagos\n")).toEqual({
      ok: false, reason: "missing_columns", missing: ["branch_name", "facility_type", "town", "address", "evidence"],
    });
  });
  it("refuses an empty file", () => {
    expect(readImport("Trading name\n")).toEqual({ ok: false, reason: "empty" });
  });
  it("the template in docs/plans has every column, in order", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path") as typeof import("node:path");
    const tpl = readFileSync(join(__dirname, "../../../../../docs/plans/diagnostic-directory-import-template.csv"), "utf8");
    expect(parseCsv(tpl)[0]).toEqual([...IMPORT_COLUMNS]);
  });
});
