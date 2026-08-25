import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AvailabilityManager } from "./availability-manager";
import { VideoVisitRequestQueue } from "./request-queue";

export default async function ClinicianAvailabilityPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Availability</h1>
        <p className="text-sm text-charcoal-ink/60">
          Manage your booking availability and video-visit requests.
        </p>
      </div>
      <VideoVisitRequestQueue />
      <AvailabilityManager organisationId={profile.organisation_id} />
    </div>
  );
}
