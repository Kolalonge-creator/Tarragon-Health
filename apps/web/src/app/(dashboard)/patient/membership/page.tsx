import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { parseNotIncluded, parsePriceChangeNotices, type FeeEstimateSchedule } from "@tarragon/commerce";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { HubLinks } from "@/components/ui/hub-links";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { EntitlementsCard } from "./entitlements-card";
import { HmoEligibilityCard } from "./hmo-eligibility-card";
import { FundSupportCard } from "./fund-support-card";
import { MembershipShop } from "./membership-shop";
import { showMonthlyEquivalent } from "./monthly-switch";
import { RefundStatusCard } from "./refund-status-card";
import { RenewalCard } from "./renewal-card";

export const metadata = { title: "Membership" };

export default async function MembershipPage() {
  // A supporter acting for someone is never the buyer here: the order is for the signed-in person (S29 opens paying for a loved one).
  const { uiLanguage } = await getPatientDashboardContext();
  // The fee estimate comes from versioned configuration, never a figure typed here (spec 17, OQ-97).
  const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;
  // What each item does not include, and any price change for something the person holds. A failed read shows nothing extra, never a wrong figure.
  const supabase = await createClient();
  const [notIncluded, notices] = await Promise.all([supabase.rpc("catalogue_not_included"), supabase.rpc("my_price_change_notices")]);
  return (
    <div className="space-y-6">
      <PageHeader title="Membership" icon={SEMANTIC_ICON.billing} backTo={{ href: "/patient", label: "Dashboard" }} />
      <HubLinks label="Related to Membership" links={[{ href: "/patient/payment-requests", label: "Ask someone to pay" }, { href: "/patient/receipts", label: "Receipts" }]} />
      <EntitlementsCard locale={uiLanguage} />
      <RenewalCard locale={uiLanguage} />
      <RefundStatusCard locale={uiLanguage} />
      <FundSupportCard locale={uiLanguage} />
      <MembershipShop locale={uiLanguage} fee={fee} notIncluded={parseNotIncluded(notIncluded.data)} priceNotices={parsePriceChangeNotices(notices.data)} showMonthly={showMonthlyEquivalent()} />
      <HmoEligibilityCard locale={uiLanguage} />
    </div>
  );
}
