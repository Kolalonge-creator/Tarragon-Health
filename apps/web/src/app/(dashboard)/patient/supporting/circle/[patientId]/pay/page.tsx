import { notFound } from "next/navigation";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import type { FeeEstimateSchedule } from "@tarragon/commerce";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { parseSupported } from "@/lib/care-circle/model";
import { MembershipShop } from "@/app/(dashboard)/patient/membership/membership-shop";

export const metadata = { title: "Pay for their care", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pay for a loved one. The name comes from the caller's own supporter list (which holds only live Care Circle memberships) and the
 * page shows the shop only when pay_for_care is ticked. The database re-checks both at the moment the order is made.
 */
export default async function PayForPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) notFound();
  const { uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_supported_people");
  const person = parseSupported(data).find((p) => p.patient_id === patientId);
  if (!person || !person.permissions.includes("pay_for_care")) notFound();
  const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;
  return (
    <div className="space-y-6">
      <PageHeader title="Pay for their care" icon={SEMANTIC_ICON.billing} backTo={{ href: `/patient/supporting/circle/${patientId}`, label: person.name }} />
      <MembershipShop locale={uiLanguage} fee={fee} beneficiary={{ id: patientId, name: person.name }} />
    </div>
  );
}
