import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { WellnessManager } from "./wellness-manager";

export default async function WellnessSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from any /admin/** route at the routing
  // layer — this is defense-in-depth, matching the other admin settings pages.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Wellness rewards
        </h1>
        <p className="text-charcoal-ink/60">
          The points/badges/challenges engagement layer, free to every patient. Toggle catalogue
          items live or hidden here, set the points-to-wallet conversion rate, and manage the
          workout-class partner catalogue — new badges/challenges/classes are authored via seed/
          migration for now, same as the health education library.
        </p>
      </div>
      <WellnessManager />
    </div>
  );
}
