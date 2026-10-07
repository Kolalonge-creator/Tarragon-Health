import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseSponsorReport, withheldText } from "@/lib/sponsors/report";

export const metadata = { title: "Sponsor group figures" };
export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

/** Aggregate group figures for one programme (S38e). No individual is listed; small groups are withheld; each view is audited. */
export default async function SponsorReportPage({ params, searchParams }: { params: Promise<{ cohortId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const { cohortId } = await params;
  if (!z.string().uuid().safeParse(cohortId).success) notFound();
  const sp = await searchParams;
  const from = date.safeParse(typeof sp.from === "string" ? sp.from : undefined);
  const to = date.safeParse(typeof sp.to === "string" ? sp.to : undefined);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sponsor_outcome_report", { p_cohort: cohortId, p_from: from.success ? from.data : undefined, p_to: to.success ? to.data : undefined });
  const r = error ? null : parseSponsorReport(data);

  return (
    <div className="space-y-6">
      <PageHeader title={r ? r.cohort.name : "Group figures"} backTo={{ href: "/admin/sponsors", label: "Sponsors" }}
        description="Figures about the members who agreed to share, as a group. No one is named or listed. A group smaller than the minimum is not shown, and neither is anything that would reveal it." />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-sm">Joined from</span><input type="date" name="from" className="min-h-11 rounded border px-2" /></label>
        <label className="space-y-1"><span className="block text-sm">Joined to</span><input type="date" name="to" className="min-h-11 rounded border px-2" /></label>
        <button type="submit" className="min-h-11 rounded border px-4">Show</button>
      </form>
      {!r ? (
        <p role="alert">The figures could not be read. Please refresh, or ask an admin or the CMO to open them.</p>
      ) : (
        <>
          <p className="text-sm">Sponsor {r.cohort.sponsor}. Smallest group shown: {r.minimum_cell}. Ranges are by whole calendar month of joining.</p>
          <Card>
            <CardHeader><CardTitle>Members</CardTitle></CardHeader>
            <CardContent>
              {r.members.suppressed ? <p>{withheldText(r.members)}</p> : <p>{r.members.agreed_to_share} of {r.members.joined} members agreed to share ({r.members.agreed_pct}%).</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Blood pressure control at day 90</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {r.bp_control_90d.suppressed ? <p>{withheldText(r.bp_control_90d)}</p> : (
                <>
                  <p><strong>{r.bp_control_90d.rate_strict_pct}%</strong> under control, counting everyone whose day 90 is due ({r.bp_control_90d.controlled} of {r.bp_control_90d.n}). People who stopped logging count as not controlled.</p>
                  <p>Among people with enough readings: {r.bp_control_90d.rate_among_measured_pct ?? "not shown (too few)"}{r.bp_control_90d.rate_among_measured_pct === null || r.bp_control_90d.rate_among_measured_pct === undefined ? "" : "%"}. No or too few readings: {r.bp_control_90d.missing_pct}%.</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Kept separate from control</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p>Change from day 0: {r.change_among_measured.suppressed ? withheldText(r.change_among_measured) : `${r.change_among_measured.mean_systolic_change} over ${r.change_among_measured.mean_diastolic_change} mmHg among ${r.change_among_measured.n} people measured at both ends.`}</p>
              <p>Medicine adherence: {r.adherence_separate.suppressed ? withheldText(r.adherence_separate) : `${r.adherence_separate.mean_pct}% on average across ${r.adherence_separate.n} people. Not a clinical outcome.`}</p>
              <p>Engagement: {r.engagement_separate.suppressed ? withheldText(r.engagement_separate) : `${r.engagement_separate.logged_a_reading_in_30_days_pct}% logged a reading in the last 30 days.`}</p>
            </CardContent>
          </Card>
          <section aria-labelledby="sp-limits" className="space-y-2 text-sm">
            <h2 id="sp-limits" className="font-medium">What this report is and is not</h2>
            <p>{r.definition}</p>
            <p>{r.limitations}</p>
          </section>
          <form method="post" action={`/admin/sponsors/${cohortId}/export`} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="from" value={from.success && from.data ? from.data : ""} />
            <input type="hidden" name="to" value={to.success && to.data ? to.data : ""} />
            <button type="submit" className="min-h-11 rounded border px-4">Download CSV</button>
            <span className="text-sm">The download is written to the audit log. Share it only with the sponsor named above.</span>
          </form>
        </>
      )}
    </div>
  );
}
