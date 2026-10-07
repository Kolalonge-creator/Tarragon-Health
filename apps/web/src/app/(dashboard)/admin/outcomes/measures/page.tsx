import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam, pct } from "@/lib/outcomes/bp-report";
import { MEASURES, isPairsShown, minutes, parseMeasureReport, parseQuality, parseResponse, parseRetention, withheldWords, type DayCohort, type Measure } from "@/lib/outcomes/measures-report";

export const metadata = { title: "Outcomes: other measures" };
export const dynamic = "force-dynamic";

const TITLES: Record<Measure, string> = { hba1c: "HbA1c", weight: "Weight", phq9: "PHQ-9 (low mood)", gad7: "GAD-7 (worry)" };
const IMPROVED: Record<Measure, string> = {
  hba1c: "improved by at least the configured number of points",
  weight: "lost at least the configured share of their weight",
  phq9: "responded (score fell by at least half)",
  gad7: "responded (score fell by at least half)",
};

function DayView({ measure, day, c }: { measure: Measure; day: string; c: DayCohort }) {
  return (
    <div className="space-y-1">
      <h3 className="font-medium">Day {day}</h3>
      {isPairsShown(c.pairs) ? (
        <p>
          Of {c.pairs.n} people measured at the start and at day {day}, {c.pairs.improved} ({pct(c.pairs.improved_pct)}) {IMPROVED[measure]}. Average change {c.pairs.mean_change ?? "not shown"}.
        </p>
      ) : (
        <p>{withheldWords(c.pairs.reason)}</p>
      )}
      {c.coverage.suppressed ? <p>Coverage: {withheldWords(c.coverage.reason)}</p> : (
        <p>Coverage: {c.coverage.with_usable_pair} of {c.coverage.due} people due had a usable result at both ends ({pct(c.coverage.with_usable_pair_pct)}); {pct(c.coverage.no_reading_pct)} had nothing recorded.</p>
      )}
      {c.by_baseline_band ? (
        <ul className="list-disc pl-5">
          {c.by_baseline_band.map((b) => (
            <li key={b.baseline_band}>Starting {b.baseline_band.replaceAll("_", " ")}: {b.suppressed ? "withheld, group too small" : `${b.n} people, ${pct(b.responded_pct)} responded, ${pct(b.in_remission_pct)} in remission`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * HbA1c, weight, PHQ-9 and GAD-7 outcomes, retention and engagement (kept apart from outcomes), response times and data quality (S75). Admin, or the CMO
 * through the database. No individual is listed. A measure shows no figure until the Chief Medical Officer has signed its definitions.
 */
export default async function OutcomeMeasuresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const args = { p_from: from ?? undefined, p_to: to ?? undefined };
  const [measureRes, retRes, respRes, qualRes] = await Promise.all([
    Promise.all(MEASURES.map((m) => supabase.rpc("outcome_measures_report", { p_measure: m, ...args }))),
    supabase.rpc("retention_completion_report", args),
    supabase.rpc("response_times_report", args),
    supabase.rpc("outcome_data_quality_report", args),
  ]);
  const retention = retRes.error ? null : parseRetention(retRes.data);
  const response = respRes.error ? null : parseResponse(respRes.data);
  const quality = qualRes.error ? null : parseQuality(qualRes.data);

  return (
    <div className="space-y-6">
      <PageHeader title="Outcomes: other measures" backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="HbA1c, weight, PHQ-9 and GAD-7 change, shown only once the Chief Medical Officer has signed the definitions. Staying and logging, response times and data quality are separate from health outcomes. Small numbers are withheld. This page lists no individual." />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-sm">Joined from</span><input type="date" name="from" defaultValue={from ?? ""} className="min-h-11 rounded border px-2" /></label>
        <label className="space-y-1"><span className="block text-sm">Joined to</span><input type="date" name="to" defaultValue={to ?? ""} className="min-h-11 rounded border px-2" /></label>
        <button type="submit" className="min-h-11 rounded border px-4">Show</button>
      </form>
      {MEASURES.map((m, i) => {
        const res = measureRes[i]!;
        const r = res.error ? null : parseMeasureReport(res.data);
        return (
          <Card key={m}>
            <CardHeader><CardTitle>{TITLES[m]}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!r ? <p role="alert">This report could not be read. Please refresh.</p>
                : r.withheld ? <p>{withheldWords(r.reason)}</p>
                : !r.has_data ? <p>No results recorded yet, so there is nothing to show.</p>
                : (
                  <>
                    {Object.entries(r.by_day).map(([d, c]) => <DayView key={d} measure={m} day={d} c={c} />)}
                    <p className="text-sm">{r.definition}</p>
                    <p className="text-sm">{r.limitations}</p>
                    {r.caveat ? <p className="text-sm">{r.caveat}</p> : null}
                  </>
                )}
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardHeader><CardTitle>Staying and logging (not a health outcome)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!retention ? <p role="alert">This report could not be read.</p> : (
            <>
              <ul className="list-disc pl-5">
                {retention.by_day.map((d) => (
                  <li key={d.day}>Day {d.day}: {d.suppressed ? withheldWords("reason" in d ? d.reason : undefined) : `${d.retained} of ${d.due} still members (${pct(d.retained_pct)}); ${pct(d.engaged_pct) ?? "engagement withheld"} logged a reading in the last 30 days`}</li>
                ))}
              </ul>
              <p>Programme completion: {retention.programme_completion.suppressed ? withheldWords(retention.programme_completion.reason) : `${retention.programme_completion.fully_used} of ${retention.programme_completion.ended_entitlements} Memberships and care packs whose term has ended were fully used, every consultation and test item (${pct(retention.programme_completion.fully_used_pct)}). This is about using what people had, not about getting better.`}</p>
              <p className="text-sm">{retention.definition}</p>
              <p className="text-sm">{retention.limitations}</p>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Response times, escalations and follow-up</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!response ? <p role="alert">This report could not be read.</p> : (
            <>
              <p className="text-sm">Tasks created from {response.range.from} to {response.range.to}.</p>
              <ul className="list-disc pl-5">
                {response.by_priority_band.map((b) => (
                  <li key={b.priority_band}>
                    {b.priority_band}: {b.suppressed ? "withheld, group too small" : `${b.tasks} tasks, ${pct(b.completed_pct)} completed (${pct(b.completed_on_time_pct)} on time), escalated ${pct(b.escalation_rate_pct)}, handed back ${pct(b.handed_back_pct)}; first claimed after ${minutes(b.median_minutes_to_first_claim)} (slowest tenth ${minutes(b.p90_minutes_to_first_claim)}), finished after ${minutes(b.median_minutes_to_completion)}`}
                  </li>
                ))}
              </ul>
              <ul className="list-disc pl-5">
                {response.by_finisher_tier.map((t) => (
                  <li key={t.doctor_tier}>Finished by {t.doctor_tier.replaceAll("_", " ")}: {t.suppressed ? withheldWords(t.reason) : `${t.tasks_finished} tasks, median ${minutes(t.median_minutes_to_completion)}`}</li>
                ))}
              </ul>
              <p>Follow-up work: {response.follow_up.suppressed ? "withheld, group too small" : `${pct(response.follow_up.completed_pct)} completed, ${pct(response.follow_up.completed_on_time_pct)} on time (${response.follow_up.tasks} tasks).`}</p>
              <p className="text-sm">{response.what_this_is}</p>
              <p className="text-sm">{response.limitations}</p>
              <p className="text-sm">What is waiting now, page acknowledgement and cover are on the <Link href="/admin/ops/reliability" className="underline">reliability dashboard</Link>.</p>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>How complete the data is</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!quality ? <p role="alert">This report could not be read.</p> : (
            <>
              <ul className="list-disc pl-5">
                {quality.snapshot_completeness.map((f) => (
                  <li key={`${f.family}-${f.day}`}>{f.family.replaceAll("_", " ")}, day {f.day}: {f.suppressed ? withheldWords("reason" in f ? f.reason : undefined) : `${f.due} due; ${pct(f.measured_pct)} measured, ${pct(f.nothing_recorded_pct)} nothing recorded, ${pct(f.excluded_pct)} excluded`}</li>
                ))}
              </ul>
              <ul className="list-disc pl-5">
                {quality.reading_sources.map((s) => (
                  <li key={s.source}>Blood pressure readings from {s.source}: {s.suppressed ? "withheld, too few people" : `${s.people} people, ${s.readings} readings, ${pct(s.flagged_for_review_pct)} waiting for a clinician`}</li>
                ))}
              </ul>
              <p>Device and wearable readings: {quality.sync_lag.suppressed ? "withheld, too few people" : `median ${quality.sync_lag.median_hours_to_arrive ?? "?"} hours to arrive; ${pct(quality.sync_lag.arrived_after_grace_pct)} arrived more than ${quality.sync_lag.grace_days} days late and are not in the outcome they came too late for.`}</p>
              <p className="text-sm">{quality.what_this_is}</p>
              <p className="text-sm">{quality.limitations}</p>
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-sm">None of this makes a claim about cause, ranks anyone, or is a reason to withhold care.</p>
    </div>
  );
}
