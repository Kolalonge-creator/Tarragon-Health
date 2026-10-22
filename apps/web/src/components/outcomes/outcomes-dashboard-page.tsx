import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_PATHS, type DashboardViewer } from "@/lib/outcomes/dashboard-paths";
import { runDashboardAction } from "@/lib/outcomes/dashboard-actions";
import {
  engagementSeries,
  isShown,
  meanCiOf,
  parseDashboard,
  pct,
  pctOfShare,
  signed,
  withheldKey,
  type CohortCell,
  type DashboardRow,
  type Did,
  type DmGroup,
  type HtnGroup,
} from "@/lib/outcomes/dashboard-report";
import { BeforeAfterChart, EngagementTrendChart } from "./outcomes-dashboard-charts";

const field = "mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";
const OUTCOME: Record<string, { ok: boolean; key: MessageKey }> = {
  run_done: { ok: true, key: "outcomes.dash.run.done" },
  run_error: { ok: false, key: "outcomes.dash.run.error" },
};
const tt = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

function Withheld({ c }: { c: { reason?: string } }) {
  return <span className="text-charcoal-ink/60">{tt(withheldKey(c))}</span>;
}

function Tile({ label, cell, children }: { label: string; cell: { suppressed: boolean; reason?: string }; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-charcoal-ink/5 p-3 text-sm">
      <p className="text-xs text-charcoal-ink/70">{label}</p>
      {cell.suppressed ? <Withheld c={cell} /> : <p className="text-lg font-semibold">{children}</p>}
    </div>
  );
}

function DidLine({ label, d, unit }: { label: string; d: Did; unit: "pp" | "mmHg" | "pct-points" }) {
  if (!d.available) return <li>{label}: {tt("outcomes.dash.compare.did_unavailable")}</li>;
  const scale = unit === "pp" ? (x: number) => signed(x * 100, 1) : (x: number) => signed(x, 2);
  return (
    <li>
      {label}: <strong>{scale(d.difference)}</strong> ({scale(d.low)} to {scale(d.high)}) {d.interval_includes_zero ? tt("outcomes.dash.compare.did_includes_zero") : tt("outcomes.dash.compare.did_excludes_zero")}
    </li>
  );
}

function CohortBlock({ title, c, day }: { title: string; c: CohortCell; day: number }) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      {isShown(c) ? (
        <>
          <p className="text-sm">{tt("outcomes.dash.outcomes.bp_strict", { pct: pct(c.rate_strict_pct), controlled: c.controlled, n: c.n })}</p>
          <p className="text-sm">
            {c.rate_among_measured_pct != null ? tt("outcomes.dash.outcomes.bp_measured", { n: c.controlled + c.uncontrolled, pct: pct(c.rate_among_measured_pct) }) : tt("outcomes.dash.withheld")}
          </p>
          <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.outcomes.bp_missing", { n: c.insufficient_data, pct: pct(c.missing_pct), day })}</p>
        </>
      ) : (
        <p className="text-sm">{tt("outcomes.dash.not_enough")}</p>
      )}
    </div>
  );
}

function groupLabel(g: string): string {
  return tt(`outcomes.dash.compare.group.${g}` as MessageKey);
}

function HtnGroups({ groups, day }: { groups: HtnGroup[]; day: number }) {
  const order = ["high", "middle", "low", "earners", "non_earners"];
  const sorted = [...groups].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return (
    <ul className="space-y-2 text-sm">
      {sorted.map((g) => (
        <li key={g.group} className="rounded-lg bg-charcoal-ink/5 p-3">
          <p className="font-medium">{groupLabel(g.group)}</p>
          {g.suppressed ? (
            <p><Withheld c={g} /></p>
          ) : (
            <>
              <p>{tt("outcomes.dash.compare.n", { n: g.people_measured_at_both_ends })}{g.not_measured_at_both_ends_pct != null ? `. ${tt("outcomes.dash.compare.not_measured_pct", { pct: pct(g.not_measured_at_both_ends_pct) })}` : ""}</p>
              <p>
                {tt("outcomes.dash.compare.before_after", { day, before: `${pct(g.controlled_before_pct)} (${pctOfShare(g.controlled_before_interval.low)} to ${pctOfShare(g.controlled_before_interval.high)})`, after: `${pct(g.controlled_after_pct)} (${pctOfShare(g.controlled_after_interval.low)} to ${pctOfShare(g.controlled_after_interval.high)})` })}
              </p>
              <p>{tt("outcomes.dash.compare.systolic_change", { mean: signed(g.systolic_change.mean, 1), low: signed(g.systolic_change.low, 1), high: signed(g.systolic_change.high, 1) })}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function DmGroups({ groups }: { groups: DmGroup[] }) {
  const order = ["high", "middle", "low", "earners", "non_earners"];
  const sorted = [...groups].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return (
    <ul className="space-y-2 text-sm">
      {sorted.map((g) => (
        <li key={g.group} className="rounded-lg bg-charcoal-ink/5 p-3">
          <p className="font-medium">{groupLabel(g.group)}</p>
          {g.suppressed ? (
            <p><Withheld c={g} /></p>
          ) : (
            <>
              <p>{tt("outcomes.dash.compare.n_hba1c", { n: g.people_with_hba1c_change })}</p>
              <p>{tt("outcomes.dash.compare.hba1c_change", { mean: signed(g.hba1c_change.mean, 2), low: signed(g.hba1c_change.low, 2), high: signed(g.hba1c_change.high, 2) })}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The honest outcomes dashboard, for the founder / super admin and for the Chief Medical Officer (whose account role cannot open /admin, so the
 * same page is mounted under /clinician). Engagement and clinical outcomes are separate panels and are never combined into a score. The page
 * says in plain words, at the top and always, that it is internal and that a difference between people who take part more and less is an
 * association, not proof. Everything shown has already passed the database's small-group rules; a held-back figure is said to be held back and is
 * never drawn as a zero. Reads go through read_outcomes_dashboard, which refuses everyone else and writes each read to the audit log.
 */
export async function OutcomesDashboardPage({ viewer, outcome }: { viewer: DashboardViewer; outcome?: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_outcomes_dashboard", { p_limit: 12 });
  const rows: DashboardRow[] | null = error ? null : parseDashboard(data);
  const latest = rows?.[0];
  const flash = outcome ? OUTCOME[outcome] : undefined;
  const base = DASHBOARD_PATHS[viewer];
  const today = new Date().toISOString().slice(0, 7);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{tt("outcomes.dash.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.intro")}</p>
      </header>

      <div role="note" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">{tt("outcomes.dash.internal")}</p>
        <p>{tt("outcomes.dash.caveat.selection")}</p>
        <p>{tt("outcomes.dash.caveat.trial")}</p>
        <p>{tt("outcomes.dash.caveat.association")}</p>
      </div>

      {flash && (
        <p role={flash.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {tt(flash.key)}
        </p>
      )}

      {!rows && <p role="alert" className="text-sm">{tt("outcomes.dash.load_error")}</p>}
      {rows && rows.length === 0 && <p className="text-sm">{tt("outcomes.dash.none")}</p>}

      {latest && (
        <>
          <p className="text-sm text-charcoal-ink/70">
            {latest.period_start.slice(0, 7)} · {tt("outcomes.dash.cut_at", { date: latest.data_cutoff })}
            {latest.is_baseline ? ` · ${tt("outcomes.dash.baseline")}` : ""}
          </p>
          {latest.held_back && <p className="rounded-lg bg-charcoal-ink/5 p-3 text-sm">{tt("outcomes.dash.held_back")}</p>}

          <EngagementPanel rows={rows ?? []} latest={latest} />
          <OutcomesPanel latest={latest} />
          <ComparisonPanel latest={latest} />
        </>
      )}

      <Card>
        <CardHeader><CardTitle>{tt("outcomes.dash.definitions.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{tt("outcomes.dash.definitions.body")}</p>
          <p>{tt("outcomes.dash.caveat.bp_excluded")}</p>
          <p>{tt("outcomes.dash.caveat.measured")}</p>
          <p>{tt("outcomes.dash.outcomes.not_measured")}</p>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{tt("outcomes.dash.run.title")}</CardTitle></CardHeader>
          <CardContent>
            <form action={runDashboardAction} className="space-y-2">
              <input type="hidden" name="viewer" value={viewer} />
              <label className="block text-sm">
                {tt("outcomes.dash.run.month")}
                <input name="month" type="month" required max={today} className={field} />
              </label>
              <button type="submit" className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{tt("outcomes.dash.run.submit")}</button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{tt("outcomes.dash.export.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{tt("outcomes.dash.export.body")}</p>
            <form method="post" action={`${base}/export`}>
              <button type="submit" className="min-h-11 rounded-lg border border-charcoal-ink/30 px-4 py-2 text-sm font-semibold">{tt("outcomes.dash.export.submit")}</button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function EngagementPanel({ rows, latest }: { rows: DashboardRow[]; latest: DashboardRow }) {
  const e = latest.report.panels.engagement;
  const series = engagementSeries(rows);
  return (
    <Card>
      <CardHeader><CardTitle>{tt("outcomes.dash.engagement.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.engagement.note")}</p>
        <p className="text-xs text-charcoal-ink/70">{tt("outcomes.dash.minimum", { n: e.minimum_cell })}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={tt("outcomes.dash.engagement.active_people")} cell={e.active_people}>{!e.active_people.suppressed ? e.active_people.people : null}</Tile>
          <Tile label={tt("outcomes.dash.engagement.logging_days")} cell={e.active_logging_days}>
            {!e.active_logging_days.suppressed ? e.active_logging_days.person_days : null}
            {!e.active_logging_days.suppressed && <span className="block text-xs font-normal">{tt("outcomes.dash.engagement.logging_days_mean", { n: e.active_logging_days.mean_per_active_person })}</span>}
          </Tile>
          <Tile label={tt("outcomes.dash.engagement.lessons")} cell={e.lessons_completed}>{!e.lessons_completed.suppressed ? tt("outcomes.dash.engagement.of_people", { count: e.lessons_completed.count, people: e.lessons_completed.people }) : null}</Tile>
          <Tile label={tt("outcomes.dash.engagement.checkins")} cell={e.medicine_checkins_answered}>{!e.medicine_checkins_answered.suppressed ? tt("outcomes.dash.engagement.of_people", { count: e.medicine_checkins_answered.count, people: e.medicine_checkins_answered.people }) : null}</Tile>
          <Tile label={tt("outcomes.dash.engagement.screenings")} cell={e.screenings_done}>{!e.screenings_done.suppressed ? tt("outcomes.dash.engagement.of_people", { count: e.screenings_done.count, people: e.screenings_done.people }) : null}</Tile>
          <Tile label={tt("outcomes.dash.engagement.milestones")} cell={e.milestones}>{!e.milestones.suppressed ? tt("outcomes.dash.engagement.of_people", { count: e.milestones.count, people: e.milestones.people }) : null}</Tile>
          <Tile label={tt("outcomes.dash.engagement.points")} cell={e.points_issued}>{!e.points_issued.suppressed ? tt("outcomes.dash.engagement.of_people", { count: e.points_issued.points, people: e.points_issued.earners }) : null}</Tile>
        </div>
        <p className="text-xs text-charcoal-ink/70">{tt("outcomes.dash.engagement.points_note")}</p>

        <h3 className="text-sm font-semibold">{tt("outcomes.dash.engagement.cohort")}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left"><th>{tt("outcomes.dash.engagement.cohort")}</th><th>{tt("outcomes.dash.people")}</th><th>{tt("outcomes.dash.engagement.logging_days")}</th><th>{tt("outcomes.dash.engagement.points")}</th></tr>
          </thead>
          <tbody>
            {e.by_cohort.map((k) => (
              <tr key={k.cohort}>
                <td>{k.cohort === "not_a_member" ? tt("outcomes.dash.engagement.not_a_member") : k.cohort}</td>
                {k.suppressed ? <td colSpan={3}><Withheld c={k} /></td> : (<><td>{k.active_people}</td><td>{k.mean_active_days}</td><td>{k.points_issued}</td></>)}
              </tr>
            ))}
          </tbody>
        </table>

        {series.length > 1 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{tt("outcomes.dash.engagement.trend")}</h3>
            <EngagementTrendChart data={series} label={tt("outcomes.dash.engagement.trend")} />
            <ul className="text-xs text-charcoal-ink/70">
              {series.map((s) => (<li key={s.month}>{s.month}: {s.people == null ? tt("outcomes.dash.withheld") : `${s.people} / ${s.points == null ? tt("outcomes.dash.withheld") : s.points}`}</li>))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomesPanel({ latest }: { latest: DashboardRow }) {
  const o = latest.report.panels.outcomes;
  return (
    <Card>
      <CardHeader><CardTitle>{tt("outcomes.dash.outcomes.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.outcomes.note")}</p>
        <p className="text-xs text-charcoal-ink/70">{tt("outcomes.dash.minimum", { n: o.minimum_cell })}</p>
        {o.hypertension.map((b) => (
          <div key={`h${b.day}`} className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            <CohortBlock title={tt("outcomes.dash.outcomes.bp", { day: b.day })} c={b.due} day={b.day} />
            {isShown(b.due) && (
              <>
                {b.before && isShown(b.before) && <p className="text-sm">{tt("outcomes.dash.outcomes.bp_before", { pct: pct(b.before.rate_strict_pct) })}</p>}
                {b.strict_rate_interval && <p className="text-xs text-charcoal-ink/70">{tt("outcomes.dash.outcomes.interval", { low: pctOfShare(b.strict_rate_interval.low), high: pctOfShare(b.strict_rate_interval.high) })}</p>}
                {b.before && isShown(b.before) && (
                  <BeforeAfterChart
                    data={[{ name: tt("outcomes.dash.outcomes.bp", { day: b.day }), before: b.before.rate_strict_pct, after: b.due.rate_strict_pct }]}
                    label={tt("outcomes.dash.outcomes.chart", { day: b.day })}
                    beforeLabel={tt("outcomes.dash.outcomes.chart_before")}
                    afterLabel={tt("outcomes.dash.outcomes.chart_after", { day: b.day })}
                  />
                )}
                {b.systolic_change && (() => {
                  const s = meanCiOf(b.systolic_change);
                  return s ? (
                    <p className="text-sm">{tt("outcomes.dash.outcomes.systolic", { mean: signed(s.mean, 1), n: s.n, low: signed(s.low, 1), high: signed(s.high, 1) })}</p>
                  ) : (
                    <p className="text-sm"><Withheld c={"reason" in b.systolic_change ? b.systolic_change : {}} /></p>
                  );
                })()}
                {b.adherence && (b.adherence.suppressed ? <p className="text-sm"><Withheld c={b.adherence} /></p> : <p className="text-sm">{tt("outcomes.dash.outcomes.adherence", { pct: pct(b.adherence.mean_pct), n: b.adherence.people })}</p>)}
              </>
            )}
          </div>
        ))}

        {o.diabetes.map((b) => (
          <div key={`d${b.day}`} className="space-y-1 border-t border-charcoal-ink/10 pt-3 text-sm">
            <h4 className="font-semibold">{tt("outcomes.dash.outcomes.hba1c", { day: b.day })}</h4>
            {(() => {
              const s = meanCiOf(b.hba1c_change);
              return s ? <p>{tt("outcomes.dash.outcomes.hba1c_change", { mean: signed(s.mean, 2), n: s.n, low: signed(s.low, 2), high: signed(s.high, 2) })}</p> : <p>{tt("outcomes.dash.not_enough")}</p>;
            })()}
            {b.hba1c_goal.suppressed ? <p><Withheld c={b.hba1c_goal} /></p> : <p>{tt("outcomes.dash.outcomes.hba1c_goal", { pct: pct(b.hba1c_goal.reached_pct), reached: b.hba1c_goal.reached, n: b.hba1c_goal.people })}</p>}
          </div>
        ))}

        <div className="space-y-1 border-t border-charcoal-ink/10 pt-3 text-sm">
          <h4 className="font-semibold">{tt("outcomes.dash.outcomes.review")}</h4>
          {o.time_to_first_review.suppressed ? (
            <p>{tt("outcomes.dash.not_enough")}</p>
          ) : o.time_to_first_review.reviewed > 0 ? (
            <p>{tt("outcomes.dash.outcomes.review_body", { reviewed: o.time_to_first_review.reviewed, results: o.time_to_first_review.results, median: o.time_to_first_review.median_hours ?? "-", p90: o.time_to_first_review.p90_hours ?? "-", waiting: o.time_to_first_review.waiting_for_first_review })}</p>
          ) : (
            <p>{tt("outcomes.dash.outcomes.review_none_reviewed", { results: o.time_to_first_review.results })}</p>
          )}
        </div>

        <div className="space-y-1 border-t border-charcoal-ink/10 pt-3 text-sm">
          <h4 className="font-semibold">{tt("outcomes.dash.outcomes.escalations")}</h4>
          <ul>
            {o.escalations.map((x) => (
              <li key={x.status}>{tt(`outcomes.dash.outcomes.status.${x.status}` as MessageKey)}: {x.suppressed ? <Withheld c={x} /> : x.people}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonPanel({ latest }: { latest: DashboardRow }) {
  const c = latest.report.panels.comparison;
  const sections = [
    { by: "engagement" as const, title: tt("outcomes.dash.compare.by_engagement") },
    { by: "points" as const, title: tt("outcomes.dash.compare.by_points") },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>{tt("outcomes.dash.compare.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div role="note" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{tt("outcomes.dash.caveat.selection")}</p>
          <p>{tt("outcomes.dash.caveat.association")}</p>
        </div>
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.compare.note", { day: c.day })}</p>
        <p className="text-xs text-charcoal-ink/70">{tt("outcomes.dash.compare.threshold", { n: c.minimum_per_group })} {c.engagement_excludes_blood_pressure_readings ? tt("outcomes.dash.caveat.bp_excluded") : ""}</p>
        {sections.map(({ by, title }) => {
          const h = c.cohorts.hypertension[by];
          const d = c.cohorts.diabetes[by];
          const chart = h.groups.flatMap((g) => (g.suppressed ? [] : [{ name: groupLabel(g.group), before: g.controlled_before_pct, after: g.controlled_after_pct }]));
          return (
            <section key={by} className="space-y-3 border-t border-charcoal-ink/10 pt-3">
              <h3 className="text-base font-semibold">{title}</h3>
              <h4 className="text-sm font-semibold">{tt("outcomes.dash.compare.hypertension")}</h4>
              <HtnGroups groups={h.groups} day={c.day} />
              {chart.length > 0 && (
                <BeforeAfterChart data={chart} label={tt("outcomes.dash.compare.chart", { day: c.day })} beforeLabel={tt("outcomes.dash.outcomes.chart_before")} afterLabel={tt("outcomes.dash.outcomes.chart_after", { day: c.day })} />
              )}
              <div className="space-y-1 text-sm">
                <p className="font-medium">{tt("outcomes.dash.compare.did_title")}</p>
                <ul className="list-disc space-y-1 pl-5">
                  <DidLine label={tt("outcomes.dash.compare.did_control")} d={h.difference_in_differences.control} unit="pp" />
                  <DidLine label={tt("outcomes.dash.compare.did_systolic")} d={h.difference_in_differences.systolic} unit="mmHg" />
                </ul>
              </div>
              <h4 className="text-sm font-semibold">{tt("outcomes.dash.compare.diabetes")}</h4>
              <DmGroups groups={d.groups} />
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <DidLine label={tt("outcomes.dash.compare.did_hba1c")} d={d.difference_in_differences.hba1c} unit="pct-points" />
              </ul>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
