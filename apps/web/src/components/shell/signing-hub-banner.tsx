import Link from "next/link";
import { APP_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";

/**
 * Chief-Medical-Officer-only banner pointing at the one sign-off hub
 * (/clinician/clinical-signoff). It replaces the AI-governance-only banner:
 * AI governance is now one line on the hub among all the things that need the
 * CMO's signature, and both read the same list (readCmoSigningHub), so the
 * count here is always the count the hub shows.
 *
 * Rendered from (dashboard)/layout.tsx, gated there on
 * isActiveChiefMedicalOfficer(staff). No dismiss control: it tracks real
 * outstanding work and disappears on its own when the count reaches zero.
 * When a read failed it says so rather than going quiet, since a missing
 * banner would read as "nothing to sign".
 */
export function SigningHubBanner({
  outstandingCount,
  liveUnsignedCount,
  failed,
}: {
  /** Lines on the hub (one per area: a line can stand for several rules or blocks), not individual items. */
  outstandingCount: number;
  /** How many of those are already driving behaviour with no signature on file. */
  liveUnsignedCount: number;
  failed: boolean;
}) {
  if (!failed && outstandingCount === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-start sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <APP_ICON.approvals className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
        <p>
          {failed && outstandingCount === 0 ? (
            "Sign-off counts could not be loaded, so this is not an all-clear. Open the sign-off hub to check."
          ) : (
            <>
              <strong>
                {formatNumber(outstandingCount)} {outstandingCount === 1 ? "area needs" : "areas need"} your signature.
              </strong>{" "}
              {liveUnsignedCount > 0
                ? `${formatNumber(liveUnsignedCount)} ${liveUnsignedCount === 1 ? "is" : "are"} already live with no signature on file.`
                : "None are live without one yet."}
              {failed ? " Some counts could not be loaded, so there may be more." : ""}
            </>
          )}
        </p>
      </div>
      <Link
        href="/clinician/clinical-signoff"
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
      >
        Open sign-off hub
      </Link>
    </div>
  );
}
