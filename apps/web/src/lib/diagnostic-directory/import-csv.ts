/**
 * Diagnostic directory Phase 7: read the data-collection spreadsheet (saved as CSV) into staged rows. This only reshapes the
 * file; every rule about what a row may contain is checked by the database when the batch is staged
 * (private.diagnostic_import_problems), so a malformed row is shown with its reasons rather than dropped here.
 */

/** The columns of spec §15.4, as sent to admin_dx_import_stage. */
export const IMPORT_COLUMNS = [
  "provider_ref", "legal_name", "trading_name", "branch_name", "facility_type", "state", "lga", "town", "address",
  "latitude", "longitude", "phone", "email", "investigation_codes", "regulator", "regulator_name", "registration_number",
  "registration_expires_on", "accreditation_body", "accreditation_number", "accreditation_scope_codes", "accreditation_expires_on",
  "partner_status", "service_verification_date", "evidence", "evidence_url", "record_status",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["trading_name", "branch_name", "facility_type", "state", "town", "address", "evidence"];

/** Spreadsheet headings as people type them, mapped to column keys. */
const ALIASES: Record<string, ImportColumn> = {
  provider_id: "provider_ref", tarragon_id: "provider_ref", registered_name: "legal_name", name: "trading_name",
  branch: "branch_name", type: "facility_type", kind: "facility_type", contact: "phone", telephone: "phone",
  investigation_ids: "investigation_codes", investigations: "investigation_codes", tests: "investigation_codes",
  regulatory_body: "regulator", registration_status: "record_status", accreditation_scope: "accreditation_scope_codes",
  source: "evidence", evidence_link: "evidence_url", link: "evidence_url",
};

export const MAX_IMPORT_ROWS = 2000;

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** RFC 4180 CSV: commas, double-quoted fields, doubled quotes inside quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ReadImport =
  | { ok: true; rows: Partial<Record<ImportColumn, string>>[]; ignoredHeaders: string[] }
  | { ok: false; reason: "empty" | "missing_columns" | "too_many_rows"; missing?: ImportColumn[] };

export function readImport(text: string): ReadImport {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, reason: "empty" };
  const known = new Set<string>(IMPORT_COLUMNS);
  const headers = table[0].map((h) => {
    const k = key(h);
    return known.has(k) ? (k as ImportColumn) : (ALIASES[k] ?? null);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) return { ok: false, reason: "missing_columns", missing };
  if (table.length - 1 > MAX_IMPORT_ROWS) return { ok: false, reason: "too_many_rows" };
  const ignoredHeaders = table[0].filter((_, i) => headers[i] === null);
  const rows = table.slice(1).map((cells) => {
    const out: Partial<Record<ImportColumn, string>> = {};
    headers.forEach((h, i) => {
      if (h && out[h] === undefined) out[h] = (cells[i] ?? "").trim();
    });
    return out;
  });
  return { ok: true, rows, ignoredHeaders };
}
