import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PharmacistWorklist } from "./pharmacist-worklist";

export default async function PharmacistPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Partner-pharmacy surface only. Other roles never see patient PHI here —
  // and even if they reached the RPCs, private.pharmacist_partner() returns
  // null for them, so nothing would come back.
  if (profile.role !== "pharmacist") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-charcoal-ink/70">
          This area is for partner pharmacies.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-xl font-semibold text-brand-green">
        Pharmacy dashboard
      </h1>
      <PharmacistWorklist />
    </div>
  );
}
