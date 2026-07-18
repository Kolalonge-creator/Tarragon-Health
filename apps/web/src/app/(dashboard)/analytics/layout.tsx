import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AnalyticsNav } from "./_components/analytics-nav";

/**
 * Platform Analytics & Audit Console — a company-wide, cross-organisation
 * surface for the dedicated `analyst` role, kept separate from `admin` (which
 * stays operational/settings-focused). Access is gated here at the layout so
 * every sub-page is covered; the underlying data RPCs are independently gated
 * by private.is_analyst(), so even a bypassed page would return nothing.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (profile.role !== "analyst") {
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-clinical-navy">
          Platform analytics
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Company-wide business, financial, and population-health intelligence across every
          organisation — aggregate, visualise, and export.
        </p>
      </div>
      <AnalyticsNav />
      {children}
    </div>
  );
}
