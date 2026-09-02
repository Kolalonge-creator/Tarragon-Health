import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { isPlatformModuleEnabled } from "@/lib/platform-modules";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

/**
 * Module 28 (provider organisation platform) — server guard. Mirrors
 * (dashboard)/payer/layout.tsx exactly: module switch, then (for a
 * non-superadmin) an active seat, before anything under /provider-org
 * renders. Every table/RPC underneath enforces this again at the database
 * (private.is_provider_org_staff_for, which additionally requires the
 * specific organisation to be is_operational).
 */
export default async function ProviderOrgLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "provider_org_staff" && profile.role !== "admin") redirect("/");

  const moduleEnabled = await isPlatformModuleEnabled("provider_org_platform");
  const greeting = `Welcome${profile.full_name ? `, ${profile.full_name}` : ""}`;

  if (!moduleEnabled) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Provider organisation"
        comingUp={[
          "The provider organisation platform is built and ready — a Tarragon superadmin has not switched it on yet.",
        ]}
      />
    );
  }

  if (profile.role === "admin") {
    return <>{children}</>;
  }

  const supabase = await createClient();
  const { data: seats } = await supabase
    .from("provider_org_members")
    .select("organisation_id")
    .eq("is_active", true);

  if (!seats || seats.length === 0) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Provider organisation"
        comingUp={["Your login isn't linked to an organisation yet — ask a Tarragon admin to add you."]}
      />
    );
  }

  return <>{children}</>;
}
