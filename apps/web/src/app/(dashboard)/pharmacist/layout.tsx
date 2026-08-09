import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PharmacistPageHeader } from "./_components/page-header";

/**
 * Partner-pharmacy surface, gated once for every /pharmacist/* route (same
 * shape as analytics/layout.tsx and finance/layout.tsx). Other roles never
 * see patient PHI here — and even if they reached the RPCs,
 * private.pharmacist_partner() returns null for them, so nothing would come
 * back (see 20260716178000_pharmacist_surface.sql).
 */
export default async function PharmacistLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (profile.role !== "pharmacist") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-charcoal-ink/70">This area is for partner pharmacies.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <PharmacistPageHeader />
      {children}
    </div>
  );
}
