import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { LabPartnerWorklist } from "./lab-partner-worklist";

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
    <div className="p-6">
      <h1 className="mb-4 font-heading text-xl font-semibold text-brand-green">
        Lab dashboard
      </h1>
      <LabPartnerWorklist />
    </div>
  );
}
