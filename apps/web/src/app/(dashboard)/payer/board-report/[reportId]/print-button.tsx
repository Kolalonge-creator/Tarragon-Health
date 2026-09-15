"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" strokeWidth={2} />
      Print or save as PDF
    </Button>
  );
}
