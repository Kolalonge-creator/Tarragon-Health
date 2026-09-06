import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { loadCorporateDashboardData } from "./dashboard-data";
import { CorporateNav } from "./corporate-nav";
import { CorporatePageHeader } from "./corporate-page-header";

/**
 * Only "no-org" and "no-access" have nothing at all to show — no
 * organisation_id even exists yet to hang the HR-shaped surfaces
 * (roster/eligibility/campaigns/billing) off, so those two states still
 * short-circuit to a placeholder with no nav.
 *
 * "suppressed" (cohort too small for the ML-driven analytics) and
 * "no-analytics" (ML service unavailable) used to ALSO short-circuit here,
 * which meant a brand-new or small employer — or any employer while the ML
 * service happened to be down — could not reach Eligibility & Benefits,
 * Campaigns & Messages, or Billing at all: none of those tabs need cohort
 * analytics, only `organisationId`, which all three of these states already
 * carry (see dashboard-data.ts). So the nav and `children` now render for
 * every state that has an organisation — each tab route decides for itself
 * how to handle "not enough data for a cohort analytic" rather than being
 * denied a route entirely. Overview and Reports (the two tabs that actually
 * need the cohort analytics) still render their own degraded content for
 * "suppressed"/"no-analytics" — see their own page.tsx files.
 */
export default async function CorporateLayout({ children }: { children: React.ReactNode }) {
  const data = await loadCorporateDashboardData();

  if (data.state === "no-org") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health: cohort risk distribution"]}
      />
    );
  }

  if (data.state === "no-access") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="Corporate admin"
        comingUp={["Workforce health: cohort risk distribution"]}
      />
    );
  }

  return (
    <div className="space-y-6">
      <CorporatePageHeader />
      <CorporateNav />
      {children}
    </div>
  );
}
