import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Receipts</h1>
        <p className="text-charcoal-ink/60">
          Every payment you have made — membership, labs, pharmacy, referrals, video
          consultations, and care vouchers you bought.
        </p>
      </div>
      <ReceiptsList />
    </div>
  );
}
