import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { isPlatformModuleEnabled } from "@/lib/platform-modules";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

/**
 * Module 27 (insurer/payer platform) — server guard. Three independent
 * things all have to be true before anything under /payer renders real
 * content for a payer_admin login: the payer_platform module switched on,
 * and at least one active payer_administrators seat. Every table/RPC
 * underneath enforces this again at the database
 * (private.is_payer_admin_for) — this layer only avoids showing an empty
 * console instead of an honest "not yet activated" placeholder.
 *
 * A Tarragon superadmin (`admin`) skips the seat check: someone has to be
 * able to create the first insurer and assign the first seat before any
 * payer_administrators row can exist at all — private.is_payer_admin_for
 * already grants admin unconditionally for exactly this reason.
 */
export default async function PayerLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "payer_admin" && profile.role !== "admin") redirect("/");

  const moduleEnabled = await isPlatformModuleEnabled("payer_platform");
  const greeting = `Welcome${profile.full_name ? `, ${profile.full_name}` : ""}`;

  if (!moduleEnabled) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Payer admin"
        comingUp={[
          "The insurer/payer platform is built and ready. A Tarragon superadmin has not switched it on yet.",
        ]}
      />
    );
  }

  if (profile.role === "admin") {
    return <>{children}</>;
  }

  const supabase = await createClient();
  const { data: seats } = await supabase
    .from("payer_administrators")
    .select("insurer_id")
    .eq("is_active", true);

  if (!seats || seats.length === 0) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Payer admin"
        comingUp={["Your login isn't linked to an insurer yet. Ask a Tarragon admin to add you."]}
      />
    );
  }

  return <>{children}</>;
}
