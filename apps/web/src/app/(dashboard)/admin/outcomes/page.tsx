import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam, isShown, parseReport, pct, withheldText, type Cohort } from "@/lib/outcomes/bp-report";

export const metadata = { title: "Outcomes" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function CohortView({ title, c }: { title: string; c: Cohort }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isShown(c) ? (
          <>
            <p>
              <strong>{pct(c.rate_strict_pct)}</strong> had blood pressure under control at day 90, counting everyone in this group ({c.controlled} of {c.n}).
              People who stopped logging count as not controlled.
            </p>
            <p>Among the {c.controlled + c.uncontrolled} people with enough readings: {pct(c.rate_among_measured_pct) ?? "not shown (too few)"}.</p>
            <p>
              No readings or too few at day 90: {c.insufficient_data} people ({pct(c.missing_pct)}). Not controlled: {c.uncontrolled}.
            </p>
          </>
        ) : (
          <p>{withheldText(c)}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminOutcomesPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check. The database also refuses anyone but an admin or the CMO.
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bp_control_report", { p_from: from ?? undefined, p_to: to ?? undefined });
  const report = error ? null : parseReport(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outcomes"
        backTo={{ href: "/admin", label: "Admin" }}
        description="Blood pressure control 90 days after people join. Everyone whose day-90 window has closed is counted, including people who stopped logging. Small numbers are withheld. This page lists no individual."
      />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm">Joined from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-sm">Joined to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <button type="submit" className="min-h-11 rounded border px-4">Show</button>
      </form>
      {!report ? (
        <p role="alert">The report could not be read. Please refresh, or ask an admin or the CMO to open it.</p>
      ) : (
        <>
          <CohortView title="Everyone whose day 90 is due" c={report.cohort_all_due} />
          <CohortView title="People who started above target" c={report.cohort_baseline_uncontrolled} />
          <Card>
            <CardHeader>
              <CardTitle>Change and adherence (kept apart from control)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {"suppressed" in report.change_among_measured ? (
                <p>Average change in blood pressure: {withheldText(report.change_among_measured)}</p>
              ) : (
                <p>
                  Average change among the {report.change_among_measured.n} people measured at both ends: {report.change_among_measured.mean_systolic_change} over{" "}
                  {report.change_among_measured.mean_diastolic_change} mmHg. Only people who kept logging are in this figure.
                </p>
              )}
              {"suppressed" in report.adherence_separate ? (
                <p>Medicine adherence: {withheldText(report.adherence_separate)}</p>
              ) : (
                <p>Medicine adherence: {report.adherence_separate.mean_pct}% on average across {report.adherence_separate.n} people. This is not a clinical outcome.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How complete the data is</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {"suppressed" in report.data_quality ? (
                <p>{withheldText(report.data_quality)} Enrolled in this range: {report.data_quality.enrolled_total ?? "unknown"}.</p>
              ) : (
                <ul className="list-disc pl-5">
                  <li>Enrolled: {report.data_quality.enrolled_total}; day 90 not due yet: {report.data_quality.not_yet_due}.</li>
                  <li>No day-0 baseline: {pct(report.data_quality.baseline_missing_pct)}.</li>
                  <li>No usable reading at day 90: {pct(report.data_quality.day90_no_reading_pct)}.</li>
                  <li>Held to the default 140/90 because no personal target was set: {pct(report.data_quality.default_target_used_pct)}.</li>
                  <li>Readings that arrived after the snapshot was taken: {pct(report.data_quality.readings_arriving_after_snapshot_pct)}.</li>
                </ul>
              )}
            </CardContent>
          </Card>
          {report.by_enrolment_month.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>By month joined</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {report.by_enrolment_month.map((m) => (
                    <li key={m.enrolment_month}>
                      {m.enrolment_month.slice(0, 7)}: {isShown(m) ? `${pct(m.rate_strict_pct)} of ${m.n} (missing ${pct(m.missing_pct)})` : withheldText(m)}
                    </li>
                  ))}
                </ul>
                {report.months_withheld > 0 ? <p className="mt-2 text-sm">{report.months_withheld} month(s) left out because a group was too small.</p> : null}
              </CardContent>
            </Card>
          ) : null}
          <section aria-labelledby="out-limits" className="space-y-2 text-sm">
            <h2 id="out-limits" className="font-medium">What this report is and is not</h2>
            <p>{report.definition}</p>
            <p>{report.limitations}</p>
            <p>It makes no claim about cause, is not a ranking of anyone, and is never a reason to withhold care. Rules version {report.config_version}; smallest group shown {report.minimum_cell}.</p>
          </section>
        </>
      )}
    </div>
  );
}
