import { strFromU8, unzipSync } from "fflate";
import { buildXlsx, colName, excelDate } from "./xlsx";
import { EXPORT_COLUMNS, exportRow } from "./export-rows";
import type { DirectoryRow } from "./model";

describe("xlsx writer", () => {
  it("names columns like a spreadsheet", () => {
    expect([colName(0), colName(25), colName(26), colName(51), colName(52)]).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });
  it("converts dates to the Excel day count", () => {
    expect(excelDate(new Date("1970-01-01T00:00:00Z"))).toBe(25569);
  });
  it("shifts dates to Lagos wall-clock time when asked, so the file matches the page", () => {
    const at = new Date("2026-10-01T08:00:00Z");
    expect(excelDate(at, 1) - excelDate(at)).toBeCloseTo(1 / 24, 10);
    const cell = (offset: number) =>
      strFromU8(unzipSync(buildXlsx("S", [{ header: "H", kind: "date" }], [[at]], offset))["xl/worksheets/sheet1.xml"] as Uint8Array).match(/<v>([\d.]+)<\/v>/)?.[1];
    expect(Number(cell(1)) - Number(cell(0))).toBeCloseTo(1 / 24, 8);
  });
  it("keeps text starting with = or + as plain text, unprefixed", () => {
    const sheet = strFromU8(unzipSync(buildXlsx("S", [{ header: "H" }], [["=1+1"], ["+234*****123"]]))["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=1+1</t>');
    expect(sheet).toContain(">+234*****123<");
  });
  it("writes a valid zip with the sheet, escaped text and typed cells", () => {
    const bytes = buildXlsx("Patients", [{ header: "Name" }, { header: "N", kind: "number" }, { header: "When", kind: "date" }], [
      ["A & B <x>", 3, new Date("2026-01-02T03:04:00Z")],
      [null, null, null],
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
    ]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet).toContain("A &amp; B &lt;x&gt;");
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
    expect(sheet).not.toContain('r="A3"');
  });
});

describe("directory export", () => {
  const row: DirectoryRow = {
    patient_id: "11111111-1111-4111-8111-111111111111", full_name: "=Ada", patient_number: "TH-1", phone_masked: "+234*****123", city: null, state: null,
    age_band: "30-39", sex: "female", account_type: "Self", is_active: true, joined_at: "2026-01-01T00:00:00Z", onboarded_at: null,
    last_login_at: null, login_count: 0, last_active_at: null, activity_status: "never", visits_total: 0, visits_30d: 0, active_days_30d: 0,
    time_spent_seconds: 0, avg_visit_seconds: 0, main_device: null, actions_total: 0, actions_30d: 0, last_action_at: null, top_actions: [],
    top_sections: [], plan: "free", membership_state: null, membership_source: null, membership_started_at: null, membership_ends_at: null,
    auto_renew: false, purchases_count: 0, paid_total_kobo: 250000, last_purchase_at: null,
  };
  it("has exactly one value per column, so a column can never drift off its header", () => {
    expect(exportRow(row)).toHaveLength(EXPORT_COLUMNS.length);
  });
  it("reports money in naira, not kobo", () => {
    const i = EXPORT_COLUMNS.findIndex((c) => c.header === "Paid in total (NGN)");
    expect(exportRow(row)[i]).toBe(2500);
  });
  it("carries no email or date-of-birth column", () => {
    const heads = EXPORT_COLUMNS.map((c) => c.header.toLowerCase()).join("|");
    expect(heads).not.toMatch(/email|birth|diagnos|condition/);
  });
});
