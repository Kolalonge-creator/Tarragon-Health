import { toCsv, type CsvRow } from "./to-csv";

/**
 * Browser-only: trigger a client-side download of `rows` as a .csv file.
 * Split from to-csv.ts (which stays pure/testable) because this touches
 * document/Blob/URL.
 */
export function downloadCsv(filename: string, rows: CsvRow[], columns?: string[]): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
