/**
 * Tiny, dependency-free CSV serializer (RFC 4180 quoting) for exporting any
 * analytics dataset. Kept pure and separate from the browser download helper so
 * it can be unit-tested in the node jest environment.
 */

export type CsvValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvValue>;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote if the cell contains a comma, quote, or newline; escape quotes by doubling.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialize rows to CSV. When `columns` is omitted, the union of keys across all
 * rows (in first-seen order) is used as the header.
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  const cols =
    columns ??
    Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );

  if (cols.length === 0) return "";

  const header = cols.map(escapeCell).join(",");
  const body = rows.map((row) => cols.map((c) => escapeCell(row[c])).join(",")).join("\r\n");
  return body ? `${header}\r\n${body}` : header;
}
