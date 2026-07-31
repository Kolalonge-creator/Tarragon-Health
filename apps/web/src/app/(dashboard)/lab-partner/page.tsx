import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { LabPartnerWorklist } from "./lab-partner-worklist";
import { LabPartnerTurnaroundCard } from "./lab-partner-turnaround-card";
import { LabPartnerFacilities } from "./lab-partner-facilities";

export default async function LabPartnerPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Partner-lab surface only. Other roles never see patient PHI here — and
  // even if they reached the RPCs, private.lab_partner_provider() returns
  // null for them, so nothing would come back.
  if (profile.role !== "lab_partner") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-charcoal-ink/70">
          This area is for partner laboratories.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="font-heading text-xl font-semibold text-brand-green">
        Lab dashboard
      </h1>
      <LabPartnerTurnaroundCard />
      <LabPartnerWorklist />
      <LabPartnerFacilities />
    </div>
  );
}
