"use client";

import { t } from "@tarragon/i18n";

/** The browser's own print dialog, which also offers "Save as PDF". No new data path: it prints what is already on the page. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-3 rounded-md border border-charcoal-ink/20 px-3 py-1.5 text-sm text-charcoal-ink hover:bg-charcoal-ink/5 print:hidden"
    >
      {t("sharelink.print")}
    </button>
  );
}
