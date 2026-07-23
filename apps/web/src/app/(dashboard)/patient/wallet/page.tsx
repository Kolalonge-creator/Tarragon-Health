import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { WalletView } from "./wallet-view";
import { SponsorWalletCard } from "./sponsor-wallet-card";

/**
 * The Health Wallet — top up, save towards a check, referral credit, and a
 * full activity ledger. Sponsorship (topping up a family member's wallet)
 * lives here too, listing the caller's family-plan members.
 */
export default async function WalletPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  if (!profile.organisation_id) redirect("/patient");

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Health Wallet</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Money set aside for health, that only ever becomes care.
        </p>
      </div>
      <WalletView organisationId={profile.organisation_id} />
      <SponsorWalletCard />
    </div>
  );
}
