"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/analytics/download-csv";
import type { CsvRow } from "@/lib/analytics/to-csv";

/** One-click CSV export of any analytics dataset. */
export function ExportButton({
  filename,
  rows,
  columns,
  label = "Export CSV",
  disabled,
}: {
  filename: string;
  rows: CsvRow[];
  columns?: string[];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || rows.length === 0}
      onClick={() => downloadCsv(filename, rows, columns)}
    >
      <Download className="mr-1.5 h-4 w-4" strokeWidth={2} />
      {label}
    </Button>
  );
}
