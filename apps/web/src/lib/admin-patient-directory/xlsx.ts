import { strToU8, zipSync } from "fflate";

/**
 * A minimal, real .xlsx writer (an xlsx file is a zip of XML parts). One sheet, a bold header row, frozen header, filters, column
 * widths. Text is written as inline strings and dates/numbers as typed cells, so Excel can sort and filter them properly.
 * Text is always an inline string cell, which Excel never evaluates as a formula, so typed text starting with = is inert here.
 * Deliberately small: no formulas, no styles beyond the header, nothing read back from the file.
 */
export type Cell = string | number | Date | null;
export interface XlsxColumn { header: string; width?: number; kind?: "text" | "number" | "date" | "money" }

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function colName(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Excel stores a date as days since 1899-12-30.
export function excelDate(d: Date, utcOffsetHours = 0): number {
  return (d.getTime() + utcOffsetHours * 3_600_000) / 86_400_000 + 25569;
}

function cellXml(ref: string, col: XlsxColumn, v: Cell, utcOffsetHours: number): string {
  if (v === null || v === "") return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return `<c r="${ref}" s="2"><v>${excelDate(v, utcOffsetHours)}</v></c>`;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return `<c r="${ref}"${col.kind === "money" ? ' s="3"' : ""}><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/**
 * Excel has no time zones: a date cell is a plain number of days. `utcOffsetHours` shifts every date so the cell reads as wall-clock time
 * in the zone the reader expects (Lagos is a fixed UTC+1, no daylight saving). Without it a date is shown as UTC.
 */
export function buildXlsx(sheetName: string, columns: XlsxColumn[], rows: Cell[][], utcOffsetHours = 0): Uint8Array {
  const lastCol = colName(columns.length - 1);
  const lastRow = rows.length + 1;
  const head = columns.map((c, i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join("");
  const body = rows
    .map((r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => cellXml(`${colName(ci)}${ri + 2}`, columns[ci] as XlsxColumn, v, utcOffsetHours)).join("")}</row>`)
    .join("");
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join("");
  const sheet =
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData><row r="1">${head}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`;
  const styles =
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  const safeSheet = esc(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}
