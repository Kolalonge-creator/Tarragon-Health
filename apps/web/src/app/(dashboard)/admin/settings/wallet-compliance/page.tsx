import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { WalletComplianceManager, type WalletComplianceFlagRow } from "./wallet-compliance-manager";

/**
 * Review queue for the Health Wallet's CBN-readiness compliance flags —
 * see supabase/migrations/20260731020000_wallet_kyc_tiers_and_aml_flags.sql.
 * private.wallet_apply records a flag (never blocks the credit — the money
 * has already been paid for) whenever a top-up pushes a wallet past its
 * tiered-KYC balance ceiling, or a sponsor top-up looks unusually large or
 * spread across several wallets in a short window. This page is where a
 * human actually looks at what got flagged; without it the table is
 * write-only.
 */
export default async function WalletComplianceSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: flags } = await supabase
    .from("wallet_compliance_flags")
    .select(
      "id, wallet_id, flag_type, detail, status, reviewed_by, reviewed_at, created_at, health_wallets(profile_id, profiles(full_name))"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: limits } = await supabase
    .from("wallet_kyc_tier_limits")
    .select("tier, max_balance_kobo")
    .order("tier");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Health Wallet compliance flags
        </h1>
        <p className="text-charcoal-ink/60">
          A CBN-readiness control, not a CBN license — these flags surface unusual wallet activity
          for review; nothing here ever blocks a credit that&apos;s already been paid for. Verified
          identity (a completed{" "}
          <code>identity_verifications</code> check) raises a wallet&apos;s balance ceiling from the
          default tier automatically.
        </p>
      </div>
      <WalletComplianceManager
        initialFlags={(flags ?? []) as unknown as WalletComplianceFlagRow[]}
        tierLimits={limits ?? []}
      />
    </div>
  );
}
