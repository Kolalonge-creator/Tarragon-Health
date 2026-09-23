import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { isPlatformModuleEnabled } from "@/lib/platform-modules";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

/**
 * Module ngo_funded_cohort — server guard, same shape as /payer's (module
 * 27) and /provider-org's (module 28): this exists only so provisioning an
 * ngo_admin seat (apps/web/src/lib/validation/members.ts) doesn't land that
 * login on a 404 — ROLE_HOME_PATH.ngo_admin (lib/auth/roles.ts) points here.
 * Every table/RPC underneath still enforces the module gate independently
 * (private.assert_module_enabled('ngo_funded_cohort')) — this layer only
 * avoids showing a blank page instead of an honest "not yet activated"
 * placeholder. No self-serve programme UI exists yet by design — see
 * apps/web/src/lib/ngo/funding-programmes.ts's header and
 * docs/FUNDING_STRATEGY.md.
 */
export default async function NgoLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ngo_admin" && profile.role !== "admin") redirect("/");

  const moduleEnabled = await isPlatformModuleEnabled("ngo_funded_cohort");
  const greeting = `Welcome${profile.full_name ? `, ${profile.full_name}` : ""}`;

  if (!moduleEnabled) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="NGO partner admin"
        comingUp={[
          "The NGO-funded cohort programme tools are built and ready. A Tarragon superadmin has not switched it on yet.",
        ]}
      />
    );
  }

  return <>{children}</>;
}
