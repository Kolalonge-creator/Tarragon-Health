import { PrintToolbar } from "./print-toolbar";
import { ReportLetterhead } from "./letterhead";

/**
 * What a pack shows in place of itself when a data source never loaded. Printed
 * and on screen: whoever holds the paper must be able to see that it is not a
 * report. Deliberately has no figures and no section text, because an empty
 * section ("No logged finance activity", "Nothing configured") or a zero reads as
 * a statement of fact under the company letterhead.
 */
export function PackBlocked({ title, subtitle, failed }: { title: string; subtitle: string; failed: string[] }) {
  return (
    <div>
      <PrintToolbar loading />
      <ReportLetterhead title={title} subtitle={subtitle} />
      <p
        role="alert"
        className="mb-4 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-red-700"
      >
        Data unavailable: do not distribute
      </p>
      <p className="text-xs leading-relaxed text-charcoal-ink/70">
        The pack could not be built: {failed.join(", ")} did not load from the general ledger. No figures are shown,
        deliberately, because a missing source would print as an empty section or a zero, which reads as a statement of
        fact rather than a gap. Reload this page, and if it keeps failing, take it up with whoever maintains the finance
        reporting RPCs before sharing anything from this report.
      </p>
    </div>
  );
}

/** Printed, not just shown: whoever holds the paper needs to know the figures on it were not confirmed on the last attempt. */
export function PackStaleBanner({ stale }: { stale: string[] }) {
  if (stale.length === 0) return null;
  return (
    <p
      role="status"
      className="mb-4 rounded-md border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-amber-800"
    >
      May be out of date: {stale.join(", ")} could not be refreshed. Figures shown are the last read from the general
      ledger. Reload before distributing.
    </p>
  );
}
