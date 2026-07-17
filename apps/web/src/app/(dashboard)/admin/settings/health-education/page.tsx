import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { HealthEducationManager } from "./health-education-manager";

export default async function HealthEducationSettingsPage() {
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
          Health education library
        </h1>
        <p className="text-charcoal-ink/60">
          The clinician-reviewed learning catalogue surfaced to patients on Complete Care and
          above (and Essential Care with the add-on). Content is personalised to each patient&apos;s
          active conditions and risk. Toggle an item live or hidden here; authoring the body and
          knowledge check is done via seed/migration for now.
        </p>
      </div>
      <HealthEducationManager />
    </div>
  );
}
