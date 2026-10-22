import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  baselineLines,
  careTeamNotes,
  describeMilestone,
  isClinicianReview,
  parseGoals,
  summariseMilestones,
  type MilestoneRow,
} from "@/lib/pathway-home/model";

export const metadata = { title: "Your care pathway" };
export const dynamic = "force-dynamic";

/**
 * The pathway home (S61/S62, spec 13.15): the person's goals, where they started, what comes next and what their care team is doing.
 * Read-only. It reads only the person's own rows (RLS: patient_id = auth.uid()), so a supporter acting for someone is sent back to the
 * dashboard, as the programmes page does. Nothing here is scored, and a milestone whose date has passed says "due", never "late".
 */
export default async function PathwayHomePage() {
  const { acting, uiLanguage } = await getPatientDashboardContext();
  if (acting) redirect("/patient");
  const supabase = await createClient();
  const now = new Date();

  const { data: enrolments, error } = await supabase
    .from("chronic_programme_enrolments")
    .select("id, status, programme:chronic_condition_programmes(name, default_goals)")
    .eq("status", "enrolled")
    .order("enrolled_at", { ascending: true });

  const rows = error ? null : (enrolments ?? []);
  const ids = (rows ?? []).map((e) => e.id);

  // One query each for every enrolment, then grouped here, so the page costs three reads however many pathways the person is on.
  const [milestonesRes, baselinesRes, pausesRes] =
    ids.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
          supabase.from("pathway_milestones").select("enrolment_id, cycle, code, due_at, met_at").in("enrolment_id", ids),
          supabase.from("pathway_baselines").select("enrolment_id, cycle, snapshot").in("enrolment_id", ids),
          supabase.from("pathway_lifecycle_events").select("enrolment_id, action, created_at").in("enrolment_id", ids).order("created_at", { ascending: false }),
        ]);
  const loadFailed = error !== null || milestonesRes.error !== null || baselinesRes.error !== null || pausesRes.error !== null;

  return (
    <div className="space-y-6">
      <PageHeader backTo={{ href: "/patient", label: "Dashboard" }} title={t("pathway.title", uiLanguage)} description={t("pathway.subtitle", uiLanguage)} />
      {loadFailed || rows === null ? (
        <p role="alert">{t("pathway.error", uiLanguage)}</p>
      ) : rows.length === 0 ? (
        <p>{t("pathway.none", uiLanguage)}</p>
      ) : (
        rows.map((e) => {
          const programme = Array.isArray(e.programme) ? e.programme[0] : e.programme;
          const mine = (milestonesRes.data ?? []).filter((m) => m.enrolment_id === e.id);
          const cycle = mine.reduce((max, m) => Math.max(max, m.cycle), 0);
          const milestones: MilestoneRow[] = mine.filter((m) => m.cycle === cycle).map((m) => ({ code: m.code, due_at: m.due_at, met_at: m.met_at }));
          const summary = summariseMilestones(milestones, now);
          const nextReview = summarisedReview(milestones, now);
          // The latest lifecycle event decides "paused": a pause is undone by a resume, and the log is append-only.
          const lastLifecycle = (pausesRes.data ?? []).find((p) => p.enrolment_id === e.id && (p.action === "pause" || p.action === "resume"));
          const paused = lastLifecycle?.action === "pause";
          const baseline = (baselinesRes.data ?? []).filter((b) => b.enrolment_id === e.id).sort((a, b) => b.cycle - a.cycle)[0];
          const goals = parseGoals(programme?.default_goals);
          const lines = baselineLines(baseline?.snapshot);
          const notes = careTeamNotes({ paused, nextReview, now });
          const what = (code: string) => {
            const d = describeMilestone(code);
            return t(d.key, uiLanguage, d.params ? { check: t(d.params.check, uiLanguage) } : undefined);
          };

          return (
            <Card key={e.id}>
              <CardHeader>
                <CardTitle>{programme?.name ?? t("pathway.title", uiLanguage)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {paused ? <p role="status" className="rounded border p-3 text-sm">{t("pathway.paused_banner", uiLanguage)}</p> : null}

                <section aria-labelledby={`goals-${e.id}`} className="space-y-1">
                  <h2 id={`goals-${e.id}`} className="font-medium">{t("pathway.goals_title", uiLanguage)}</h2>
                  {goals.length === 0 ? (
                    <p className="text-sm">{t("pathway.goals_none", uiLanguage)}</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {goals.map((g) => (
                        <li key={g.description}>{t("pathway.goal_line", uiLanguage, { description: g.description, value: g.target_value, unit: g.target_unit })}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-labelledby={`start-${e.id}`} className="space-y-1">
                  <h2 id={`start-${e.id}`} className="font-medium">{t("pathway.baseline_title", uiLanguage)}</h2>
                  {lines.length === 0 ? (
                    <p className="text-sm">{t("pathway.baseline_none", uiLanguage)}</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {lines.map((l) => (
                        <li key={l.key}>{t(l.key, uiLanguage, l.params)}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-labelledby={`next-${e.id}`} className="space-y-1">
                  <h2 id={`next-${e.id}`} className="font-medium">{t("pathway.next_title", uiLanguage)}</h2>
                  {summary.next === null ? (
                    <p className="text-sm">{t("pathway.next_none", uiLanguage)}</p>
                  ) : (
                    <p className="text-sm">
                      {summary.nextIsDue
                        ? t("pathway.next_due", uiLanguage, { what: what(summary.next.code) })
                        : t("pathway.next_on", uiLanguage, { what: what(summary.next.code), date: formatPatientDate(summary.next.due_at) })}
                    </p>
                  )}
                  {summary.later.length > 0 ? (
                    <>
                      <h3 className="pt-2 text-sm font-medium">{t("pathway.later_title", uiLanguage)}</h3>
                      <ul className="space-y-1 text-sm">
                        {summary.later.map((m) => (
                          <li key={m.code}>{t("pathway.next_on", uiLanguage, { what: what(m.code), date: formatPatientDate(m.due_at) })}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {summary.met.length > 0 ? (
                    <>
                      <h3 className="pt-2 text-sm font-medium">{t("pathway.done_title", uiLanguage)}</h3>
                      <ul className="space-y-1 text-sm">
                        {summary.met.map((m) => (
                          <li key={m.code}>{t("pathway.done_line", uiLanguage, { what: what(m.code), date: formatPatientDate(m.met_at ?? m.due_at) })}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </section>

                <section aria-labelledby={`team-${e.id}`} className="space-y-1">
                  <h2 id={`team-${e.id}`} className="font-medium">{t("pathway.team_title", uiLanguage)}</h2>
                  <ul className="space-y-1 text-sm">
                    {notes.map((n) => (
                      <li key={n}>{t(NOTE_KEY[n], uiLanguage, n === "review_planned" && nextReview ? { date: formatPatientDate(nextReview.due_at) } : undefined)}</li>
                    ))}
                  </ul>
                </section>

                <p className="text-sm font-medium">{t("pathway.emergency_note", uiLanguage)}</p>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

const NOTE_KEY: Record<ReturnType<typeof careTeamNotes>[number], MessageKey> = {
  readings_checked: "pathway.team.readings_checked",
  paused: "pathway.team.paused",
  review_planned: "pathway.team.review_planned",
  review_due: "pathway.team.review_due",
};

/** The soonest unmet clinician review, which is the only milestone the "care team" lines speak about. */
function summarisedReview(milestones: MilestoneRow[], now: Date): MilestoneRow | null {
  return summariseMilestones(milestones.filter((m) => isClinicianReview(m.code)), now).next;
}
