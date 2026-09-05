import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { ReceiptsList } from "./receipts-list";

export default async function PatientReceiptsPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        icon={NAV_ICON.receipts}
        description="Every payment you have made: membership, labs, pharmacy, referrals, video consultations, and care vouchers you bought."
      />
      <ReceiptsList />
    </div>
  );
}
