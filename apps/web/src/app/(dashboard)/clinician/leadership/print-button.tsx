"use client";

/** Prints the overview as it is on screen (the browser offers Save as PDF). The page's own print styles drop the navigation. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-10 items-center rounded-full border border-charcoal-ink/15 bg-white px-4 text-sm font-medium text-charcoal-ink hover:border-brand-green focus-visible:outline-2 focus-visible:outline-brand-green print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
