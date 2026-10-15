import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam } from "@/lib/outcomes/bp-report";
import { parseResponseReport, timesText } from "@/lib/outcomes/response-report";

export const metadata = { title: "Care team response times" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const pct = (n: number | null | undefined) => (typeof n === "number" ? `${n.toFixed(1)}%` : null);

export default async function ResponseTimesPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check. The database also refuses anyone but an admin or an analyst.
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinical_response_report", { p_from: from ?? undefined, p_to: to ?? undefined });
  const report = error ? null : parseResponseReport(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Care team response times"
        backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="How quickly the care team picks up and finishes tasks and acknowledges pages. These are descriptions of what happened, for internal review only. They are not targets, not a ranking of anyone, and not for publication."
      />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm">Created from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-sm">Created to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <button type="submit" className="min-h-11 rounded border px-4">Show</button>
      </form>
      {!report ? (
        <p role="alert">The report could not be read. Please refresh, or ask an admin or an analyst to open it.</p>
      ) : (
        <>
          <p className="text-sm">Showing {report.range.from} to {report.range.to}. Test accounts are never counted. Any group with fewer than {report.minimum_cell} cases is left out, so a small number cannot point to one person.</p>
          <Card>
            <CardHeader>
              <CardTitle>Tasks, by type and priority class</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {report.tasks.length === 0 ? <p>No tasks in this range.</p> : null}
              {report.tasks.map((g) => (
                <section key={`${g.task_type}-${g.priority_class}`} aria-label={`${g.task_type} class ${g.priority_class}`} className="space-y-1">
                  <h2 className="font-medium">{g.task_type}, class {g.priority_class}</h2>
                  {g.suppressed ? (
                    <p>Fewer than {report.minimum_cell} tasks, so nothing is shown.</p>
                  ) : (
                    <ul className="list-disc pl-5 text-sm">
                      <li>Time to first claim: {timesText(g.time_to_claim_minutes, report.minimum_cell)}</li>
                      <li>Time to complete: {timesText(g.time_to_complete_minutes, report.minimum_cell)}</li>
                      <li>Open and past due now: {g.overdue_open_now}</li>
                      <li>Completed after the due time: {g.completed_after_due}</li>
                    </ul>
                  )}
                </section>
              ))}
              {report.task_groups_withheld > 0 ? <p className="text-sm">{report.task_groups_withheld} group(s) left out because they were too small.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Urgent pages, by role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {report.pages.length === 0 ? <p>No pages in this range.</p> : null}
              {report.pages.map((g) => (
                <section key={g.page_role} aria-label={`${g.page_role} pages`} className="space-y-1">
                  <h2 className="font-medium">{g.page_role}</h2>
                  {g.suppressed ? (
                    <p>Fewer than {report.minimum_cell} pages, so nothing is shown.</p>
                  ) : (
                    <ul className="list-disc pl-5 text-sm">
                      <li>Time to acknowledge: {timesText(g.time_to_acknowledge_minutes, report.minimum_cell)}</li>
                      <li>Time to close: {timesText(g.time_to_close_minutes, report.minimum_cell)}</li>
                      <li>Not yet acknowledged, still open: {g.unacknowledged_open_now}</li>
                    </ul>
                  )}
                </section>
              ))}
              {report.page_groups_withheld > 0 ? <p className="text-sm">{report.page_groups_withheld} role(s) left out because they were too small.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How complete the data is</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Members with at least one blood pressure reading in the last 30 days:{" "}
                {report.data_quality.members_with_a_bp_reading_suppressed ? `not shown (fewer than ${report.minimum_cell} members)` : pct(report.data_quality.members_with_a_bp_reading_last_30_days_pct)}.
              </p>
              <p>
                Day-90 blood pressure snapshots with too little data to judge:{" "}
                {report.data_quality.day90_snapshots_suppressed ? `not shown (fewer than ${report.minimum_cell} snapshots)` : pct(report.data_quality.day90_snapshots_insufficient_data_pct)}.
              </p>
            </CardContent>
          </Card>
          <p className="text-sm">Typical means the middle value. Slowest tenth means nine in ten were faster. This describes what happened. It makes no claim about why and is never a reason to withhold care.</p>
        </>
      )}
    </div>
  );
}
