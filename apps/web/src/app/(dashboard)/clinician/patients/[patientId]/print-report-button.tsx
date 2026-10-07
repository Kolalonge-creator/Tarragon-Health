"use client";

import { Button } from "@/components/ui/button";

/** Opens the browser print dialog, which can also save the page as a PDF. Hidden when printing. */
export function PrintReportButton() {
  return (
    <Button type="button" size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
