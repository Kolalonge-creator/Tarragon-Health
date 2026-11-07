import { Suspense } from "react";
import { MembershipWorkspace } from "../_components/revenue-workspaces";

export const metadata = { title: "Membership revenue" };

export default function FinanceMembershipPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Membership revenue</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">Paid Memberships in force, who paid, renewals and what is coming up for renewal. Granted Memberships are shown apart and never counted as revenue.</p>
      </div>
      <Suspense fallback={null}>
      <MembershipWorkspace />
      </Suspense>
    </div>
  );
}
