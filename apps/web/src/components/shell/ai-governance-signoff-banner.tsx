import Link from "next/link";
import { APP_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";

/**
 * Chief-Medical-Officer-only mirror of the amber "AI governance needs you"
 * banner admin/page.tsx renders — same copy, same counts (both read
 * readPendingAiGovernanceSignoff so they can never disagree), same
 * `formatNumber` digit-grouping, pointed at the CMO's own reachable console
 * (/clinician/ai-governance) instead of /admin/settings/ai-governance, which
 * a real CMO account (always `profiles.role = "clinician"`) cannot open
 * without a delegated grant.
 *
 * Rendered from (dashboard)/layout.tsx, gated there on
 * isActiveChiefMedicalOfficer(staff) so it only ever reaches an active Chief
 * Medical Officer — the one account that can actually act on either item. No
 * dismiss control: unlike the MFA nudge, this tracks real outstanding work,
 * not a one-time setup step, and it already disappears on its own the moment
 * the count reaches zero.
 */
export function AiGovernanceSignoffBanner({
  pendingVersionApprovalCount,
  pendingClinicalAccuracyLabelCount,
  failed,
}: {
  pendingVersionApprovalCount: number;
  pendingClinicalAccuracyLabelCount: number;
  failed: boolean;
}) {
  const attentionCount = pendingVersionApprovalCount + pendingClinicalAccuracyLabelCount;
  if (!failed && attentionCount === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-start sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <APP_ICON.approvals className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
        <p>
          {failed ? (
            "AI governance: pending-item counts could not be loaded, so this is not an all-clear — check the page directly."
          ) : (
            <>
              <strong>AI governance needs your sign-off:</strong>{" "}
              {[
                pendingVersionApprovalCount > 0 &&
                  `${formatNumber(pendingVersionApprovalCount)} AI system version${pendingVersionApprovalCount === 1 ? "" : "s"} awaiting your approval`,
                pendingClinicalAccuracyLabelCount > 0 &&
                  `${formatNumber(pendingClinicalAccuracyLabelCount)} clinical-accuracy scenario${pendingClinicalAccuracyLabelCount === 1 ? "" : "s"} awaiting your tier judgement`,
              ]
                .filter(Boolean)
                .join(" and ")}
              .
            </>
          )}
        </p>
      </div>
      <Link
        href="/clinician/ai-governance"
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
      >
        Review AI governance
      </Link>
    </div>
  );
}
