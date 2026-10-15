import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pct } from "@/lib/outcomes/bp-report";
import {
  isBpShown,
  isMeasureShown,
  MEASURE_REQUESTS,
  measureWithheldText,
  parseBp180,
  parseMeasureReport,
  type MeasureReport,
} from "@/lib/outcomes/measures-report";

/**
 * HbA1c, weight and the day-180 BP report (S75, CMO decision S-5). Aggregate only, descriptive, with the missing share beside every
 * rate and the words "no comparison group". There is no mental health measure on this screen, and there never is one: those are read
 * only by the person and by a treating clinician (S-3).
 */
function changeLine(r: MeasureReport): string {
  const c = r.change_among_measured;
  if (c.suppressed) return `Average change: ${measureWithheldText(c)}`;
  if (r.measure === "hba1c") return `Average change among the ${c.n} people with a result at both ends: ${c.mean_change_percentage_points} percentage points.`;
  return `Average change among the ${c.n} people with a weight at both ends: ${c.mean_change_percent}% (${c.mean_change_kg} kg).`;
}

export async function MeasuresSection({ supabase, from, to }: { supabase: SupabaseClient; from: string | null; to: string | null }) {
  const args = { p_from: from ?? undefined, p_to: to ?? undefined };
  const [bp, ...measures] = await Promise.all([
    supabase.rpc("bp_control_report_day", { p_day: 180, ...args }),
    ...MEASURE_REQUESTS.map((m) => supabase.rpc("outcome_measures_report", { p_measure: m.measure, p_day: m.day, ...args })),
  ]);
  const bp180 = bp.error ? null : parseBp180(bp.data);

  return (
    <section aria-labelledby="out-more" className="space-y-4">
      <h2 id="out-more" className="text-lg font-medium">More measures and day 180</h2>
      <p className="text-sm">
        These figures describe the people in them. There is no comparison group, so they say nothing about what caused a change.
        Everyone whose day is due and who has a result is counted; people with no result near the day are shown as no result, never as not improved.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Blood pressure control at day 180</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!bp180 ? (
            <p>Not available yet.</p>
          ) : isBpShown(bp180.cohort_all_due) ? (
            <>
              <p>
                <strong>{pct(bp180.cohort_all_due.rate_strict_pct)}</strong> had blood pressure under control at day 180, counting everyone in this group ({bp180.cohort_all_due.controlled} of {bp180.cohort_all_due.n}).
                People who stopped logging count as not controlled.
              </p>
              <p>No readings or too few at day 180: {bp180.cohort_all_due.insufficient_data} people ({pct(bp180.cohort_all_due.missing_pct)}).</p>
              {"suppressed" in bp180.change_among_measured ? null : (
                <p>Average change among the {bp180.change_among_measured.n} people measured at both ends: {bp180.change_among_measured.mean_systolic_change} over {bp180.change_among_measured.mean_diastolic_change} mmHg.</p>
              )}
            </>
          ) : (
            <p>{measureWithheldText(bp180.cohort_all_due)}</p>
          )}
        </CardContent>
      </Card>

      {MEASURE_REQUESTS.map((req, i) => {
        const res = measures[i];
        const report = res && !res.error ? parseMeasureReport(res.data) : null;
        return (
          <Card key={`${req.measure}-${req.day}`}>
            <CardHeader>
              <CardTitle>{req.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!report ? (
                <p>Not switched on yet. The CMO has to approve and activate these measures first.</p>
              ) : isMeasureShown(report.cohort_all_due) ? (
                <>
                  <p>
                    <strong>{pct(report.cohort_all_due.rate_strict_pct)}</strong> {req.noun}, counting everyone in this group ({report.cohort_all_due.reached} of {report.cohort_all_due.n}).
                  </p>
                  <p>Among the {report.cohort_all_due.reached + report.cohort_all_due.not_reached} people with a result: {pct(report.cohort_all_due.rate_among_measured_pct) ?? "not shown (too few)"}.</p>
                  <p>No result near the day: {report.cohort_all_due.insufficient_data} people ({pct(report.cohort_all_due.missing_pct)}).</p>
                  <p>{changeLine(report)}</p>
                  <p className="text-sm">{report.goal === "" ? null : `Goal: ${report.goal}.`} {report.definition} {report.limitations}</p>
                </>
              ) : (
                <p>{measureWithheldText(report.cohort_all_due)}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
