import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import type { FeeEstimateSchedule } from "@tarragon/commerce";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { MembershipShop } from "./membership-shop";

export const metadata = { title: "Membership" };

export default async function MembershipPage() {
  // A supporter acting for someone is never the buyer here: the order is for the signed-in person (S29 opens paying for a loved one).
  const { uiLanguage } = await getPatientDashboardContext();
  // The fee estimate comes from versioned configuration, never a figure typed here (spec 17, OQ-97).
  const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;
  return (
    <div className="space-y-6">
      <PageHeader title="Membership" icon={SEMANTIC_ICON.billing} backTo={{ href: "/patient", label: "Dashboard" }} />
      <MembershipShop locale={uiLanguage} fee={fee} />
    </div>
  );
}
