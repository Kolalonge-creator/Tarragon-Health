import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { RefundRequestsAdmin } from "./refund-requests-admin";

export const metadata = { title: "Refund requests" };

export default async function AdminRefundRequestsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defence-in-depth check on top of that,
  // same pattern as /admin/bookings, since this page's content (not just its
  // RLS-protected data) is admin-only. decide_purchase_guarantee_refund is
  // itself admin-gated at the DB layer too (raises 42501 for anyone else).
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refund requests"
        description="First-purchase money-back guarantee claims waiting for a decision."
      />
      <RefundRequestsAdmin />
    </div>
  );
}
