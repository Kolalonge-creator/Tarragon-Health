import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Fee-at-risk contracts"
        description="HMO and corporate admins propose their own contract terms from their dashboard; nothing takes effect on outcomes_contracts until you approve it here."
      />
      <OutcomesContractReviewQueue />
    </div>
  );
}
