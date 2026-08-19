import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AnalyticsNav } from "./_components/analytics-nav";
import { AnalyticsPageHeader } from "./_components/page-header";

/**
 * Platform Analytics & Audit Console — a company-wide, cross-organisation
 * surface for the dedicated `analyst` role AND the `admin` super admin (who has
 * full platform control, so holds every analyst surface plus its own operational
 * ones — "all the analyst data and more"). Access is gated here at the layout so
 * every sub-page is covered; the underlying data RPCs are independently gated by
 * private.is_analyst() (widened to analyst OR admin in
 * 20260718230100_rbac_partner_rls_and_analyst_admin.sql), so even a bypassed page
 * would return nothing.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (profile.role !== "analyst" && profile.role !== "admin") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="font-heading text-xl font-semibold text-clinical-navy">
          Platform analytics
        </h1>
        <p className="mt-2 text-sm text-charcoal-ink/70">
          This console is for platform analysts. If you need company-wide reporting access, ask an
          administrator to grant you the analyst role.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AnalyticsPageHeader />
      {/* The dedicated `analyst` role gets every category as a grouped
       * sidebar link (see the "analyst" case in lib/navigation.ts) — this
       * in-page pill-tab bar would just duplicate that. `admin` has this
       * console alongside everything else, so their sidebar keeps a single
       * "Analytics" link and still needs this bar to move between categories. */}
      {profile.role === "admin" && <AnalyticsNav />}
      {children}
    </div>
  );
}
