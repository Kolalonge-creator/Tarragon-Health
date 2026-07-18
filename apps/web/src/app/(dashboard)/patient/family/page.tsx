import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { FamilyMembersManager } from "./family-members-manager";

/** Family Plan only — gated by public.has_feature_access('family_dashboard')
 * (granted on the 'family' plan's features[]). Defense-in-depth on top of
 * the RequiresEntitlement-gated dashboard link, same as every other
 * server-page guard in this codebase (e.g. admin/settings pages). */
export default async function FamilyDashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: hasAccess } = await supabase.rpc("has_feature_access", {
    feature: "family_dashboard",
  });
  if (!hasAccess) {
    redirect("/patient");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Family dashboard
        </h1>
        <p className="text-charcoal-ink/60">
          Everyone on your Family Plan, in one shared view — up to 4 people, or more with the
          Extra Family Member add-on.
        </p>
      </div>
      <FamilyMembersManager />
    </div>
  );
}
