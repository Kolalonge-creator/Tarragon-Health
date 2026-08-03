"use client";

import { Button } from "@/components/ui/button";

/** A tiny client island so the print page itself can stay a server component. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Print this card
    </Button>
  );
}
