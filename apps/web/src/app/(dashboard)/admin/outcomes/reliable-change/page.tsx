import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam } from "@/lib/outcomes/bp-report";
import {
  RELIABLE_CHANGE_REQUESTS,
  categoryLabel,
  cellWithheldText,
  isReliableChangeWithheld,
  parseReliableChangeReport,
  reliableChangeWithheldText,
  type ReliableChangeReport,
} from "@/lib/outcomes/reliable-change-report";

export const metadata = { title: "Reliable change (PHQ-9, GAD-7)" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Figures({ report }: { report: Exclude<ReliableChangeReport, { withheld: true }> }) {
  const rc = report.reliable_change;
  const rateText = (r: typeof report.response, noun: string) =>
    r.suppressed ? cellWithheldText(r.reason, r.minimum) : `${r.rate_strict_pct}% ${noun}, counting everyone in this group (${r.reached} of ${r.n}). No score near the day: ${r.insufficient_data} people (${r.missing_pct}%).`;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        A change of {report.reliable_change_points} points or more on the total score is counted as a reliable change, in either direction.
      </p>
      {rc.suppressed ? (
        <p>{cellWithheldText(rc.reason, rc.minimum)}</p>
      ) : (
        <ul className="list-disc pl-5">
          {rc.categories.map((c) => (
            <li key={c.key}>
              {categoryLabel(c.key)}: {c.suppressed ? cellWithheldText(c.reason, c.minimum) : `${c.n} of ${rc.n} people (${c.pct_of_group}%)`}
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="font-medium">Beside it, for the same group</p>
        <p>Response (a fall of 50% or more): {rateText(report.response, "responded")}</p>
        <p>Remission (a total under 5): {rateText(report.remission, "were in remission")}</p>
      </div>
      <p className="text-sm">{report.group}</p>
      <p className="text-sm">{report.note}</p>
      <p className="text-sm">{report.source}</p>
    </div>
  );
}

/**
 * Reliable change for the PHQ-9 and the GAD-7 (D4), beside the response and remission figures. Admin only. Group figures only: small numbers are
 * withheld, nobody is listed, and no answer to a single question or safety flag is ever read. Nothing shows until the Chief Medical Officer signs the
 * definition on the sign-off page.
 */
export default async function ReliableChangePage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const args = { p_from: from ?? undefined, p_to: to ?? undefined };
  const results = await Promise.all(RELIABLE_CHANGE_REQUESTS.map((r) => supabase.rpc("mental_health_reliable_change_report", { p_instrument: r.measure, p_day: r.day, ...args })));
  const parsed = results.map((res) => (res.error ? null : parseReliableChangeReport(res.data)));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reliable change (PHQ-9, GAD-7)"
        backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="How many people's scores moved by enough to count as a real change, beside the response and remission figures. Group figures only, small numbers withheld, no one is listed."
      />
      <p className="text-sm">Ranges are by whole calendar month of joining, so a figure cannot be narrowed to a few people. These figures are descriptive, not causal.</p>
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
      {RELIABLE_CHANGE_REQUESTS.map((req, i) => {
        const report = parsed[i];
        return (
          <Card key={`${req.measure}-${req.day}`}>
            <CardHeader><CardTitle>{req.title}</CardTitle></CardHeader>
            <CardContent>
              {!report ? (
                <p>Not available yet. The outcome measures and the reliable change definition both have to be signed and switched on first.</p>
              ) : isReliableChangeWithheld(report) ? (
                <p>{reliableChangeWithheldText(report.reason)}</p>
              ) : (
                <Figures report={report} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
