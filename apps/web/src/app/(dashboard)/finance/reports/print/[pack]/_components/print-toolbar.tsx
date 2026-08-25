"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PrintToolbar() {
  return (
    <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-3">
      <Link href="/finance/reports" className="text-sm text-charcoal-ink/60 hover:text-charcoal-ink">
        ← Back to Reports &amp; filings
      </Link>
      <Button onClick={() => window.print()}>Print / Save as PDF</Button>
    </div>
  );
}
