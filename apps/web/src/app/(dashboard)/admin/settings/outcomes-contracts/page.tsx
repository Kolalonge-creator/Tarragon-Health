import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { OutcomesContractReviewQueue } from "./review-queue";

export default async function OutcomesContractsAdminPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that,
  // matching the other admin/settings pages (e.g. ai-coach/page.tsx).
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Fee-at-risk contracts
        </h1>
        <p className="text-charcoal-ink/60">
          HMO and corporate admins propose their own contract terms from their dashboard; nothing
          takes effect on outcomes_contracts until you approve it here.
        </p>
      </div>
      <OutcomesContractReviewQueue />
    </div>
  );
}
