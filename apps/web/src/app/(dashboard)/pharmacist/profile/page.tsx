import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PharmacistProfileForm } from "./pharmacist-profile-form";
import { PharmacistLocations } from "./pharmacist-locations";
import { PharmacistServices } from "./pharmacist-services";
import { PartnerStaffInviteForm } from "@/components/partner-admin/partner-staff-invite-form";

export default async function PharmacistProfilePage() {
  const profile = await getCurrentProfile();

  return (
    <div className="space-y-6">
      <PharmacistProfileForm />
      <PharmacistLocations />
      <PharmacistServices />
      {profile?.is_partner_admin && <PartnerStaffInviteForm />}
    </div>
  );
}
