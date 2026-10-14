import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PaymentRequests } from "./payment-requests";

export const metadata = { title: "Ask someone to pay" };

export default async function PaymentRequestsPage() {
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Ask someone to pay" icon={SEMANTIC_ICON.billing} backTo={{ href: "/patient/membership", label: "Membership" }} />
      <PaymentRequests locale={uiLanguage} />
    </div>
  );
}
