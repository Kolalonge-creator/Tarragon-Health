import { parseReportedDrafts, planReportedConfirm, type ReportedDraft } from "./reported-values";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

const draft: ReportedDraft = {
  documentId: "d1",
  extractionId: "e1",
  filename: "report.pdf",
  reportDate: "2026-10-01",
  confirmed: false,
  rows: [
    { code: "hba1c", label: "HbA1c", value: 6.8, unit: "%" },
    { code: "ldl", label: "LDL", value: 3.4, unit: "mmol/L" },
  ],
};

describe("parseReportedDrafts", () => {
  it("reads a well-formed answer", () => {
    const out = parseReportedDrafts([
      { document_id: "d1", extraction_id: "e1", filename: "report.pdf", report_date: "2026-10-01", confirmed: false, rows: [{ code: "hba1c", label: "HbA1c", value: 6.8, unit: "%" }] },
    ]);
    expect(out).toEqual([{ documentId: "d1", extractionId: "e1", filename: "report.pdf", reportDate: "2026-10-01", confirmed: false, rows: [{ code: "hba1c", label: "HbA1c", value: 6.8, unit: "%" }] }]);
  });
  it("treats a wrong shape as nothing to confirm", () => {
    expect(parseReportedDrafts(null)).toEqual([]);
    expect(parseReportedDrafts({})).toEqual([]);
    expect(parseReportedDrafts([{ extraction_id: "e1" }])).toEqual([]);
  });
  it("drops a row with a blank or non-numeric value, never showing it as 0", () => {
    const out = parseReportedDrafts([{ document_id: "d", extraction_id: "e", rows: [{ code: "a", value: "" }, { code: "b", value: true }, { code: "c", value: "5.5" }] }]);
    expect(out[0].rows.map((r) => [r.code, r.value])).toEqual([["c", 5.5]]);
  });
  it("drops a draft that has no usable row", () => {
    expect(parseReportedDrafts([{ document_id: "d", extraction_id: "e", rows: [{ code: "a", value: "" }] }])).toEqual([]);
  });
  it("falls back to the code when there is no label and ignores a malformed date", () => {
    const out = parseReportedDrafts([{ document_id: "d", extraction_id: "e", report_date: "01/10/2026", rows: [{ code: "ldl", value: 3 }] }]);
    expect(out[0].rows[0].label).toBe("ldl");
    expect(out[0].reportDate).toBeNull();
  });
});

describe("planReportedConfirm", () => {
  const values = { hba1c: "6.9", ldl: "3.4" };
  it("sends what the person sees, including a correction, with each unit", () => {
    expect(planReportedConfirm(draft, values, "2026-10-01")).toEqual({
      ok: true,
      args: { p_extraction_id: "e1", p_report_date: "2026-10-01", p_readings: [{ code: "hba1c", value: 6.9, unit: "%" }, { code: "ldl", value: 3.4, unit: "mmol/L" }] },
    });
  });
  it.each([["", "date"], ["01/10/2026", "date"], ["1980-01-01", "date"], ["2026-13-45", "date"]])("refuses the report date %p", (d, reason) => {
    expect(planReportedConfirm(draft, values, d)).toEqual({ ok: false, reason });
  });
  it.each([[""], ["abc"], ["-1"], ["99999999"]])("refuses the value %p", (v) => {
    expect(planReportedConfirm(draft, { ...values, ldl: v }, "2026-10-01")).toEqual({ ok: false, reason: "value" });
  });
});
