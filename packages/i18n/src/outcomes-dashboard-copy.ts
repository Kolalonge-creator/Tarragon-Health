/**
 * Words for the honest outcomes dashboard (docs/design/OUTCOMES.md). English only (decision D-14).
 *
 * Audience: the founder, super admin and the Chief Medical Officer. Never an employer, sponsor, HMO or insurer.
 *
 * Rules held by outcomes-dashboard-copy.test.ts: no em dash, no en dash; never "your doctor"; no sentence that reads as a causal claim or a result
 * (the same word list the database uses to check the stored report); nothing that could be lifted into marketing; the selection caveat, the
 * internal-only notice and the "association, not proof" statement are always present. The numbers live in the stored report; this is only the
 * wording around them.
 */
export const outcomesDashboardCopy = {
  "outcomes.dash.title": "Engagement and outcomes",
  "outcomes.dash.intro":
    "Do Health Points and taking part change how people's health turns out, or do healthier people simply take part more? This page keeps the two apart: what we reward, and what we care about. They are never added together into one score.",
  "outcomes.dash.internal": "Internal only. For the founder, super admin and Chief Medical Officer. Not for employers, sponsors, insurers or HMOs, and nothing here may be published or used in marketing.",
  "outcomes.dash.caveat.selection":
    "People who take part more are different from people who take part less. They may be healthier to begin with, more motivated, or have more time. So a difference between the two groups below is an association. It is not evidence that Health Points or taking part change health.",
  "outcomes.dash.caveat.trial":
    "Workplace wellness research has found that the people who choose to join in differ from those who do not. That is why this page also compares each person with their own first week. That helps, but it does not remove the problem.",
  "outcomes.dash.caveat.association": "Association, not proof. A difference whose interval includes zero is not a clear difference at all.",
  "outcomes.dash.caveat.bp_excluded":
    "Blood pressure readings, medicine check-ins and the Health Points they earn are not counted when the groups are drawn. A blood pressure reading is how control is measured, so counting it would build the answer into the question, and check-ins overlap the adherence figure.",
  "outcomes.dash.caveat.measured":
    "Only people measured at both ends are compared. Taking part more also makes a person more likely to be measured, so who is left in a group is itself a form of selection. Beside each estimate a worst-case estimate counts everyone due and treats a person with no usable reading as not controlled.",
  "outcomes.dash.baseline": "First report (baseline)",
  "outcomes.dash.held_back": "Held back: fewer people than the minimum became due since the last report, so the outcome figures are still cut at the last report's date.",
  "outcomes.dash.cut_at": "Outcome figures cover people due up to {date}.",
  "outcomes.dash.not_enough": "Not enough data yet. This fills in as more people reach this point. Small groups are held back so that nobody can be picked out.",
  "outcomes.dash.withheld": "Held back (too few people)",
  "outcomes.dash.withheld_neighbour": "Held back so that a smaller group beside it cannot be worked out by subtraction",
  "outcomes.dash.withheld_small_cell": "Held back because one part of this group is too small to show",
  "outcomes.dash.none": "No report has been produced yet. The first is made on the third of the month for the month before. A super admin or the Chief Medical Officer can make one now for a finished month.",
  "outcomes.dash.load_error": "The dashboard could not be read just now. Please refresh, or ask a super admin or the Chief Medical Officer to open it.",
  "outcomes.dash.month": "Month",
  "outcomes.dash.people": "People",
  "outcomes.dash.minimum": "Smallest group shown: {n} people",

  "outcomes.dash.engagement.title": "1. Engagement (what we reward)",
  "outcomes.dash.engagement.note": "Activity in the month. Adults with a real account only. Mental health, reproductive health, sexual health and HIV or hepatitis screening are never counted.",
  "outcomes.dash.engagement.active_people": "People active in the month",
  "outcomes.dash.engagement.logging_days": "Active logging days",
  "outcomes.dash.engagement.logging_days_mean": "On average {n} days for each active person",
  "outcomes.dash.engagement.lessons": "Lessons completed",
  "outcomes.dash.engagement.checkins": "Medicine check-ins answered",
  "outcomes.dash.engagement.screenings": "Screenings done",
  "outcomes.dash.engagement.milestones": "Milestones (badges, goals, programmes finished)",
  "outcomes.dash.engagement.points": "Health Points issued",
  "outcomes.dash.engagement.points_note": "Points for screenings, lab tests, reviews, lessons and courses are left out of every points figure.",
  "outcomes.dash.engagement.cohort": "By the month people joined",
  "outcomes.dash.engagement.not_a_member": "Not a member",
  "outcomes.dash.engagement.trend": "Month by month",
  "outcomes.dash.engagement.of_people": "{count} from {people} people",

  "outcomes.dash.outcomes.title": "2. Clinical outcomes (what we care about)",
  "outcomes.dash.outcomes.note": "People with hypertension or diabetes in the programme, up to the date shown. Control is judged against each person's own target, else 140/90, the same way as the other outcome pages.",
  "outcomes.dash.outcomes.bp": "Blood pressure control, day {day}",
  "outcomes.dash.outcomes.bp_strict": "{pct} under control, counting everyone due ({controlled} of {n}). People who stopped logging count as not controlled.",
  "outcomes.dash.outcomes.bp_measured": "Among the {n} people with enough readings: {pct}.",
  "outcomes.dash.outcomes.bp_missing": "{n} people ({pct}) had no or too few readings at day {day}.",
  "outcomes.dash.outcomes.bp_before": "In their first week the same people were {pct} under control.",
  "outcomes.dash.outcomes.interval": "Interval {low} to {high}",
  "outcomes.dash.outcomes.systolic": "Average change in the top number: {mean} mmHg across {n} people measured at both ends (interval {low} to {high}).",
  "outcomes.dash.outcomes.adherence": "Medicine adherence: {pct} on average across {n} people. Kept apart from control.",
  "outcomes.dash.outcomes.hba1c": "HbA1c, day {day}",
  "outcomes.dash.outcomes.hba1c_change": "Average change in HbA1c: {mean} percentage points across {n} people (interval {low} to {high}).",
  "outcomes.dash.outcomes.hba1c_goal": "{pct} reached their goal ({reached} of {n} with a result).",
  "outcomes.dash.outcomes.review": "Time to the first review of an abnormal screening result",
  "outcomes.dash.outcomes.review_body": "{reviewed} of {results} abnormal results have had a first review. The middle time was {median} hours and nine in ten were reviewed within {p90} hours. {waiting} are still waiting.",
  "outcomes.dash.outcomes.review_none_reviewed": "None of the {results} abnormal results has had a first review yet.",
  "outcomes.dash.outcomes.escalations": "Escalations raised, by where they have got to",
  "outcomes.dash.outcomes.status.open": "Open",
  "outcomes.dash.outcomes.status.under_review": "Under review",
  "outcomes.dash.outcomes.status.resolved": "Resolved",
  "outcomes.dash.outcomes.status.referred": "Referred",
  "outcomes.dash.outcomes.not_measured":
    "Not measured, because the platform keeps no record of it yet: whether a medicine refill was actually collected, and the share of glucose readings in range.",
  "outcomes.dash.outcomes.chart": "Under control: first week and day {day}",
  "outcomes.dash.outcomes.chart_before": "First week",
  "outcomes.dash.outcomes.chart_after": "Day {day}",

  "outcomes.dash.compare.title": "3. Comparison, with its limits",
  "outcomes.dash.compare.note":
    "Each person is compared with their own first week. That softens, but does not remove, the effect of who started healthier: people who start worst tend to drift back towards the average anyway (regression to the mean), and the {day} days of activity used to draw the groups overlap the time the outcome is measured.",
  "outcomes.dash.compare.by_engagement": "Taking part a lot, in between, or a little",
  "outcomes.dash.compare.by_points": "Earned Health Points, or did not",
  "outcomes.dash.compare.group.high": "Takes part a lot",
  "outcomes.dash.compare.group.middle": "In between",
  "outcomes.dash.compare.group.low": "Takes part a little",
  "outcomes.dash.compare.group.earners": "Earned points",
  "outcomes.dash.compare.group.non_earners": "Did not earn points",
  "outcomes.dash.compare.threshold": "A group needs at least {n} people measured at both ends before it is shown.",
  "outcomes.dash.compare.hypertension": "People with hypertension: blood pressure",
  "outcomes.dash.compare.diabetes": "People with diabetes: HbA1c",
  "outcomes.dash.compare.n": "{n} people measured at both ends",
  "outcomes.dash.compare.n_hba1c": "{n} people with an HbA1c change",
  "outcomes.dash.compare.not_measured_pct": "{pct} of the group were not measured at both ends",
  "outcomes.dash.compare.before_after": "Under control in the first week: {before}. At day {day}: {after}.",
  "outcomes.dash.compare.systolic_change": "Top number changed by {mean} mmHg on average (interval {low} to {high}).",
  "outcomes.dash.compare.hba1c_change": "HbA1c changed by {mean} percentage points on average (interval {low} to {high}).",
  "outcomes.dash.compare.did_title": "Difference between the two groups in how much they changed",
  "outcomes.dash.compare.did_control": "Share under control (percentage points)",
  "outcomes.dash.compare.did_control_strict": "Share under control, worst case: everyone due, no usable reading counts as not controlled (percentage points)",
  "outcomes.dash.compare.hba1c_not_measured": "{pct} of the people with diabetes in this group have no HbA1c change to show",
  "outcomes.dash.outcomes.hba1c_not_measured": "{pct} of the people with diabetes who were due have no HbA1c change to show.",
  "outcomes.dash.compare.did_systolic": "Top number (mmHg)",
  "outcomes.dash.compare.did_hba1c": "HbA1c (percentage points)",
  "outcomes.dash.compare.did_includes_zero": "The interval includes zero, so there is no clear difference.",
  "outcomes.dash.compare.did_excludes_zero": "The interval does not include zero. This is still an association, and it does not show that taking part or Health Points made the difference.",
  "outcomes.dash.compare.did_unavailable": "Not enough data yet to compare these two groups.",
  "outcomes.dash.compare.chart": "Share under control, first week and day {day}",

  "outcomes.dash.run.title": "Make a report now",
  "outcomes.dash.run.month": "A finished month",
  "outcomes.dash.run.submit": "Make the report",
  "outcomes.dash.run.done": "The report for that month is ready.",
  "outcomes.dash.run.error": "The report could not be made. Choose a month that has finished.",
  "outcomes.dash.export.title": "Download",
  "outcomes.dash.export.body": "The stored figures as a file, held-back figures marked as held back. Counts and rates only, nobody listed. Each download is logged.",
  "outcomes.dash.export.submit": "Download the figures (CSV)",
  "outcomes.dash.definitions.title": "How to read this page",
  "outcomes.dash.definitions.body":
    "Control, change and adherence use the same snapshots as the other outcome pages. Active days are days with a meal, a medicine check-in, a lesson or a reading other than blood pressure logged by the person. Figures are rounded and every group goes through the shared small-group rule.",
} as const;

/** Fill {name} placeholders. A missing value stays visible so a gap is seen, not hidden. */
export function outcomesDashText(key: keyof typeof outcomesDashboardCopy, params?: Record<string, string | number>): string {
  const raw: string = outcomesDashboardCopy[key];
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
}
