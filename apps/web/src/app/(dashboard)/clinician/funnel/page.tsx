import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FALLBACK_LABEL, parseCareFunnel, percent, perAlert } from "@/lib/funnel/model";

export const metadata = { title: "Care funnel" };
export const dynamic = "force-dynamic";

/**
 * S16-S20 W6.3: the Chief Medical Officer's read-only care funnel. Alerts, pages, completed doctor reviews and emergencies over the last
 * 30 days as a ratio per alert, and how often a patient's own lead clinician handled the task, with the reason when somebody else did.
 * Counts and shares only: no patient and no clinician is named. A CMO account is `clinician` and proxy.ts keeps it out of /admin/*, the
 * same reason /clinician/chain-health exists; the database also refuses anyone but an admin or the CMO (care_funnel_metrics).
 */
export default async function CareFunnelPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const staff = await getCurrentClinicalStaff();
  if (profile.role !== "admin" && staff?.doctor_tier !== "chief_medical_officer") redirect("/clinician");

  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("care_funnel_metrics", { p_days: 30 });
  const funnel = error ? null : parseCareFunnel(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Care funnel"
        description="From an alert to a page, a doctor review and an emergency, over the last 30 days. Counts and shares only: no patient or clinician appears here."
      />
      {!funnel ? (
        <p role="alert" className="text-sm text-charcoal-ink/70">
          The funnel could not be read just now. Nothing was changed. Please try again in a moment.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Alerts", funnel.alerts],
              ["Red-event pages", funnel.pages],
              ["Doctor reviews completed", funnel.doctor_reviews],
              ["Emergencies", funnel.emergencies],
            ].map(([label, value]) => (
              <Card key={String(label)}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-3xl">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Per alert</CardTitle>
              <CardDescription>For each alert raised in the period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-charcoal-ink">
              <p>Pages: {perAlert(funnel.ratios.pages_per_alert)}</p>
              <p>Doctor reviews: {perAlert(funnel.ratios.reviews_per_alert)}</p>
              <p>Emergencies: {perAlert(funnel.ratios.emergencies_per_alert)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Continuity</CardTitle>
              <CardDescription>Of completed tasks whose patient had a lead clinician, the share the lead handled themselves.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-charcoal-ink">
              <p>
                Handled by the lead: {percent(funnel.continuity.share)} ({funnel.continuity.handled_by_lead} of {funnel.continuity.completed_with_lead})
              </p>
              <p>Completed tasks with no lead (not counted above): {funnel.continuity.completed_without_lead}</p>
              {Object.keys(funnel.continuity.fallback_reasons).length > 0 && (
                <ul className="list-disc pl-5">
                  {Object.entries(funnel.continuity.fallback_reasons).map(([reason, n]) => (
                    <li key={reason}>
                      {FALLBACK_LABEL[reason] ?? reason}: {n}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
