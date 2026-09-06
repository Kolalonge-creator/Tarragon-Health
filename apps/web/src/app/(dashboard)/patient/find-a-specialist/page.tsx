import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { FindASpecialist } from "./find-a-specialist";

export default async function FindASpecialistPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find a specialist"
        icon={NAV_ICON.referral}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Browse Tarragon's specialist network by specialty, location, and language. Your care team still arranges the actual referral and booking."
      />
      <FindASpecialist patientLocation={{ state: profile.state, city: profile.city, area: profile.area }} />
    </div>
  );
}
