import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { listUnmatchedTransfers } from "@/lib/queries/unmatched-bank-transfers";
import { UnmatchedTransfersManager } from "./unmatched-transfers-manager";

export default async function UnmatchedTransfersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const allowed = profile.role === "admin" || (await hasPermission("finance.reconcile"));
  if (!allowed) redirect("/admin");

  const transfers = await listUnmatchedTransfers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Unmatched bank transfers</h1>
        <p className="text-sm text-charcoal-ink/70">
          A dedicated-account transfer that couldn&apos;t be applied automatically — because the payer had
          nothing outstanding, more than one thing outstanding, or paid an amount that didn&apos;t exactly
          settle an order. Nothing here has been misapplied; it&apos;s waiting on a human decision.
        </p>
      </div>
      <UnmatchedTransfersManager transfers={transfers} />
    </div>
  );
}
