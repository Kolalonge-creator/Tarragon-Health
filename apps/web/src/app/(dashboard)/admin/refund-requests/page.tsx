import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { RefundRequestsAdmin } from "./refund-requests-admin";
import { OrderRefundsAdmin } from "./order-refunds-admin";

export const metadata = { title: "Refund requests" };

export default async function AdminRefundRequestsPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refund requests"
        description="Pending refund requests waiting for a decision."
      />
      <OrderRefundsAdmin />
      <RefundRequestsAdmin />
    </div>
  );
}
