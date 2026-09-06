import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { BookingRequestsAdmin } from "./booking-requests-admin";

export default async function AdminBookingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that,
  // since this page's content (not just its RLS-protected data) is
  // admin-only.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking requests"
        description="Every facility booking request patients have submitted, across all organisations."
      />
      <BookingRequestsAdmin />
    </div>
  );
}
