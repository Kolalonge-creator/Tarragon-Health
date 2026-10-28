import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam } from "@/lib/outcomes/bp-report";
import {
  adjustmentWithheldText,
  groupWithheldText,
  isAdjustmentWithheld,
  isGroupShown,
  parseAdjustmentReport,
  type AdjustmentGroup,
} from "@/lib/outcomes/adjustment-report";

export const metadata = { title: "Blood pressure control by medicine adjustment" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function GroupCard({ g }: { g: AdjustmentGroup }) {
  return (
    <Card>
      <CardHeader><CardTitle>{g.label}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isGroupShown(g) ? (
          g.n === 0 ? (
            <p>Nobody in this group.</p>
          ) : (
            <>
              <p>
                <strong>{g.rate_strict_pct}%</strong> had blood pressure under control, counting everyone in this group ({g.controlled} of {g.n}).
              </p>
              <p>Among the people with enough recent readings: {g.rate_among_known_pct ?? "not shown (too few)"}%.</p>
              <p>Not controlled: {g.uncontrolled}. Control unknown (too few or no readings in the last 7 days): {g.control_unknown} ({g.missing_pct}%).</p>
            </>
          )
        ) : (
          <p>{groupWithheldText(g.reason, g.minimum)}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Hypertension control, split by whether a doctor adjusted the person's medicine in a window (D3). Admin only. Descriptive, not causal: doctors adjust
 * medicine more often when blood pressure is high, so the two groups are not alike. People not on a recorded medicine are shown apart. No clinician is
 * named or compared. Nothing shows until the Chief Medical Officer signs what counts as an adjustment (and the cascade definitions) on the sign-off page.
 */
export default async function ControlByAdjustmentPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bp_control_by_adjustment_report", { p_from: from ?? undefined, p_to: to ?? undefined });
  const report = error ? null : parseAdjustmentReport(data);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Blood pressure control by medicine adjustment"
        backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="Among Members on a recorded blood pressure medicine: how many have their blood pressure under control, split by whether a doctor adjusted the medicine in the last few weeks. Descriptive, not causal. No clinician is named."
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
        <p role="alert">This report could not be read. Please refresh, or ask the CMO to open it.</p>
      ) : isAdjustmentWithheld(report) ? (
        <p>{adjustmentWithheldText(report.reason)}</p>
      ) : (
        <>
          <p className="text-sm">As at <strong>{report.as_at}</strong> (the nightly cascade snapshot). &quot;Adjusted&quot; means a doctor changed or started a medicine in the {report.window_days} days up to that day.</p>
          <GroupCard g={report.adjusted} />
          <GroupCard g={report.not_adjusted} />
          <Card>
            <CardHeader><CardTitle>Shown separately</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p>
                On a recorded medicine, in total:{" "}
                {report.on_recorded_medicine.suppressed ? groupWithheldText(report.on_recorded_medicine.reason, report.on_recorded_medicine.minimum) : `${report.on_recorded_medicine.n} people`}.
              </p>
              <p>
                Hypertension on record but not on a recorded medicine (in neither group):{" "}
                {report.not_on_recorded_medicine.suppressed ? groupWithheldText(report.not_on_recorded_medicine.reason, report.not_on_recorded_medicine.minimum) : `${report.not_on_recorded_medicine.n} people`}.
              </p>
            </CardContent>
          </Card>
          <p className="text-sm">{report.limitations}</p>
          <p className="text-sm">{report.note}</p>
        </>
      )}
    </div>
  );
}
