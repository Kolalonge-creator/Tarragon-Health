import { describe, expect, it } from "@jest/globals";
import { approvalReasonText, csvCell, describeLedgerEntry, figureRows, groupCode, packToCsv, parseEligibilityFile, parseProcurementPack, rosterErrorReportToCsv } from "./files";

describe("parseEligibilityFile", () => {
  it("maps a named header in any order and ignores unknown columns", () => {
    const r = parseEligibilityFile("﻿Name;Mobile;Staff ID;Shoe size\nAda;08031234567;E1;40\n");
    expect(r.usedHeader).toBe(true);
    expect(r.unknownColumns).toEqual(["shoe_size"]);
    expect(r.rows).toEqual([{ full_name: "Ada", phone: "08031234567", employee_reference: "E1" }]);
  });
  it("falls back to the fixed order without a header and honours quotes", () => {
    const r = parseEligibilityFile('+2348031234567,a@b.ng,"Okoye, Ada",Finance\n\n');
    expect(r.usedHeader).toBe(false);
    expect(r.rows).toEqual([{ phone: "+2348031234567", email: "a@b.ng", full_name: "Okoye, Ada", department: "Finance" }]);
  });
  it("returns nothing for an empty file", () => expect(parseEligibilityFile("  \n").rows).toEqual([]));
});

describe("csv safety", () => {
  it("neutralises formula starts", () => expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)"));
  it("builds the error report and rejects a bad shape", () => {
    expect(rosterErrorReportToCsv([{ row: 3, status: "error", reason: "phone is not a valid number", contact: "+...1234" }])).toContain("3,error,phone is not a valid number,'+...1234");
    expect(rosterErrorReportToCsv({ nope: 1 })).toBeNull();
  });
});

describe("words", () => {
  it("explains ledger entries", () => {
    const t = describeLedgerEntry({ period: "2026-09-01", programme: "P", tile: "bp_control_90d", reason: "under_minimum" }, 20);
    expect(t).toContain("Blood pressure control");
    expect(t).toContain("20");
  });
  it("gives each refusal reason an action", () => {
    for (const r of ["has_errors", "second_approver_needed", "tarragon_approval_needed", "expired"]) expect(approvalReasonText(r).length).toBeGreaterThan(30);
  });
  it("groups a code in fours", () => expect(groupCode("ABCD2345")).toBe("ABCD 2345"));
});

describe("procurement pack", () => {
  const pack = parseProcurementPack({
    sponsor: "Acme",
    generated_at: "2026-10-27T10:00:00Z",
    minimum_cell: 20,
    programmes: [
      {
        name: "Acme staff",
        status: "active",
        valid_from: "2026-01-01",
        valid_to: "2027-01-01",
        latest_period: "2026-09-01",
        figures: { bp_control_90d: { suppressed: true, reason: "under_minimum", minimum: 20 }, adherence_separate: { suppressed: false, n: 30, mean_pct: 81.5 }, definition: "x" },
      },
    ],
    contracts: [],
    usage: [{ period: "2026-09-01", total_kobo: 500000, other_services_kobo: 100000, lines: [{ service_code: "lab_panel_standard", units: 40, amount_kobo: 400000 }] }],
    configuration: null,
    privacy_ledger: [{ period: "2026-09-01", programme: "Acme staff", tile: "bp_control_90d", reason: "under_minimum" }],
    methodology: "Note, with comma",
  });
  it("parses and flattens, keeping withheld tiles withheld", () => {
    expect(pack).not.toBeNull();
    expect(figureRows(pack!.programmes[0]!.figures)).toEqual([
      ["bp_control_90d", "withheld (under_minimum)"],
      ["adherence_separate.n", "30"],
      ["adherence_separate.mean_pct", "81.5"],
    ]);
  });
  it("writes a CSV with the ledger and methodology", () => {
    const csv = packToCsv(pack!);
    expect(csv).toContain("privacy_ledger,2026-09-01,Acme staff/bp_control_90d,under_minimum");
    expect(csv).toContain('methodology,,note,"Note, with comma"');
  });
});
