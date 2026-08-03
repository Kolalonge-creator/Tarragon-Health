import { NAV_ICON } from "@/lib/icons";

/**
 * Shown instead of (never alongside) a silently-empty worklist when the
 * caller's role expects an active clinical_staff row but none exists —
 * getCurrentClinicalStaff() returns null identically whether the row was
 * never created or was deactivated, so this can't and doesn't distinguish
 * the two. Without this, "no clinical_staff row" and "a genuinely quiet
 * day" render as the exact same empty state, and a doctor has no way to
 * tell them apart. Every worklist this page would otherwise show stays
 * hidden behind the same RLS/RPC gate this warns about, so nothing below
 * this card can be trusted as a real inbox until it's gone.
 */
export function ClinicalStaffSetupWarning({ roleLabel }: { roleLabel: string }) {
  const Icon = NAV_ICON.warning;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 ring-1 ring-amber-200"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={2} />
      <div className="space-y-1 text-sm">
        <p className="font-medium text-amber-900">
          {`Your ${roleLabel.toLowerCase()} account isn't linked to an active clinical record yet`}
        </p>
        <p className="text-amber-800/90">
          Every worklist on this page reads from your clinical staff record, and you don&apos;t
          have one that&apos;s active. That means an empty list below doesn&apos;t mean you have
          no work; it means the system can&apos;t show you any yet. Ask an administrator to
          activate your clinical staff record before relying on this dashboard.
        </p>
      </div>
    </div>
  );
}
