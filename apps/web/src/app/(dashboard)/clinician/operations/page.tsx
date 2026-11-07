import Link from "next/link";
import { redirect } from "next/navigation";
import {
  journeyStages,
  leadershipPeriodBounds,
  operationalWarnings,
  parseLeadershipPeriod,
  rankExecutiveAttention,
  ratioText,
} from "@tarragon/shared";
import { LoadFailure } from "@/components/ui/load-failure";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadAppointmentFigures } from "@/lib/clinical-operations/load-appointment-figures";
import { loadJourneySummary } from "@/lib/clinical-operations/load-journey-summary";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { getTestPatientIdsForRequest } from "@/lib/queries/real-patients-request";
import { createClient } from "@/lib/supabase/server";
import { AttentionPanel } from "../leadership/attention-panel";
import { KpiCard } from "../leadership/kpi-card";
import { PeriodSelector } from "../leadership/period-selector";
import { JourneyPipeline } from "./pipeline";

export const metadata = { title: "Clinical Operations" };

const NO_TARGET = "No approved target";

/** Pages that already exist for parts of the module (founder decision 2026-11-07: hub + reuse, never rebuild). */
const EXISTING_PAGES = [
  { href: "/clinician/workload", label: "Clinician workload", note: "Claims, completion and overdue tasks by doctor" },
  { href: "/clinician/team-caseload", label: "Team caseload", note: "Open work by doctor, reassign" },
  { href: "/clinician/care-operations", label: "Care operations", note: "Messages, alerts and coordinator workload" },
  { href: "/clinician/capacity", label: "Capacity and cover", note: "Intake gate, cover offers, drills" },
  { href: "/clinician/reliability", label: "Reliability and SLA", note: "Response-time performance against signed SLAs" },
  { href: "/clinician/follow-ups", label: "Follow-ups", note: "Every open clinical follow-up" },
  { href: "/clinician/lab-results", label: "Lab results", note: "Results waiting for review, hold clock" },
  { href: "/clinician/funnel", label: "Care funnel", note: "Alert to doctor review path" },
];

/**
 * CMO Clinical Operations overview (founder decisions 2026-11-07: hub + reuse; overview + patient journey first; no invented
 * targets). Org-wide journey figures come from public.cmo_patient_journey_summary (counts only, CMO only); appointment figures are
 * read under the CMO's own RLS, which covers every appointment in the organisation. Operational warnings are kept apart from
 * safety (the Leadership overview) and never go above "requires attention".
 */
export default async function ClinicalOperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  const period = parseLeadershipPeriod(params.period);
  const now = new Date();
  const bounds = leadershipPeriodBounds(period, now);
  const [supabase, testPatientIds] = await Promise.all([createClient(), getTestPatientIdsForRequest()]);
  const [summary, appts] = await Promise.all([loadJourneySummary(supabase), loadAppointmentFigures(supabase, bounds, testPatientIds)]);

  const stages = summary ? journeyStages(summary) : null;
  const warnings = summary ? rankExecutiveAttention(operationalWarnings(summary, now)) : [];
  const s = summary?.stages;
  const pct = (n: number | undefined, d: number | undefined) => ratioText(n ?? null, d ?? null);
  const onboarding = pct(s?.onboarded, s?.registered);
  const plans = pct(s?.care_plan_approved, s?.registered);
  const coordinators = pct(s?.with_coordinator, s?.registered);
  const reviewed = pct(s?.result_reviewed, s?.result_received);
  const fuClosed = pct(s?.follow_up_all_closed, s?.follow_up_raised);
  const attendance = ratioText(appts.completed, appts.completed === null || appts.noShow === null ? null : appts.completed + appts.noShow);
  const rateValue = (r: ReturnType<typeof ratioText>, known: boolean) => (r.pct !== null ? `${r.pct}%` : known ? "None yet" : null);
  const apptFailed = appts.completed === null || appts.noShow === null || appts.cancelled === null || appts.scheduledInPeriod === null;

  return (
    <div className="space-y-6 print:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-green">Chief Medical Officer</p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Clinical Operations</h1>
          <p className="mt-1 text-sm text-charcoal-ink/70">
            How the service is running: where patients are on their journey, what is waiting, and for how long. Safety concerns are on
            the <Link href="/clinician/leadership" className="font-medium text-brand-green underline">Leadership overview</Link>.
          </p>
          <p className="mt-2 text-xs text-charcoal-ink/55">
            {summary ? `Journey figures as of ${formatPatientDateTime(summary.generatedAt)} (Lagos time).` : "Journey figures could not be loaded."}{" "}
            Targets: none approved yet, so no figure is coloured as on or off target.
          </p>
        </div>
        <PeriodSelector current={period} basePath="/clinician/operations" />
      </header>

      {(!summary || apptFailed) && (
        <LoadFailure>
          {!summary ? "The org-wide journey figures could not be loaded. " : ""}
          {apptFailed ? "Some appointment figures could not be loaded. " : ""}
          Anything marked &ldquo;could not be loaded&rdquo; is unknown, not zero.
        </LoadFailure>
      )}

      <AttentionPanel
        items={warnings}
        now={now}
        limit={10}
        incomplete={!summary}
        showAllHref={null}
        heading="Clinical operations: requiring attention"
        description="Live, organisation-wide. Operational waits, not safety events: only a follow-up past its recorded due date is marked as needing attention; everything else is routine with its oldest wait shown."
        emptyText="Nothing is waiting: no overdue follow-ups, unreviewed results, outstanding lab results, draft-only care plans, unfinished onboarding or patients without a coordinator."
        headingId="ops-attention-heading"
        dateLabel="Oldest item"
      />

      <section aria-labelledby="pipeline-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="pipeline-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Service delivery pipeline</h2>
            <p className="text-sm text-charcoal-ink/65">
              Live. Patients who have reached each step. Not every patient needs every step, so a smaller number is not a failure.
            </p>
          </div>
          <Link href="/clinician/operations/journey" className="text-sm font-medium text-brand-green underline">Patient journey detail</Link>
        </div>
        {stages ? <JourneyPipeline stages={stages} /> : <p className="rounded-2xl bg-white p-5 text-sm text-charcoal-ink/70">Could not be loaded.</p>}
      </section>

      <section aria-labelledby="ops-kpi-heading" className="space-y-3">
        <div>
          <h2 id="ops-kpi-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Operational indicators</h2>
          <p className="text-sm text-charcoal-ink/65">
            Journey figures are live; appointments cover {bounds.label.toLowerCase()} ({formatPatientDate(bounds.start)} to {formatPatientDate(bounds.end)}).
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Registered patients" value={s?.registered ?? null} target={NO_TARGET} definition="Patient accounts, test accounts excluded." href="/clinician/patients" />
          <KpiCard label="Onboarding completed" value={rateValue(onboarding, !!s)} detail={onboarding.counts ? `${onboarding.counts} patients` : undefined} target={NO_TARGET} definition="Registered patients who finished onboarding." href="/clinician/operations/journey#awaiting-onboarding" />
          <KpiCard label="Care plan approved" value={rateValue(plans, !!s)} detail={plans.counts ? `${plans.counts} patients` : undefined} target={NO_TARGET} definition="Registered patients with an active or completed care plan." href="/clinician/care-plan-review" />
          <KpiCard label="Coordinator assigned" value={rateValue(coordinators, !!s)} detail={coordinators.counts ? `${coordinators.counts} patients` : undefined} target={NO_TARGET} definition="Registered patients with a named care coordinator." href="/clinician/team-caseload" />
          <KpiCard label="Results reviewed by a doctor" value={rateValue(reviewed, !!s)} detail={reviewed.counts ? `${reviewed.counts} patients with a result` : undefined} target={NO_TARGET} definition="Patients with a result who have at least one uploaded result marked reviewed." href="/clinician/lab-results" />
          <KpiCard label="Follow-ups closed" value={rateValue(fuClosed, !!s)} detail={fuClosed.counts ? `${fuClosed.counts} patients with a follow-up` : undefined} target={NO_TARGET} definition="Patients whose follow-ups are all closed with a recorded outcome (a sent reminder never counts)." href="/clinician/follow-ups" />
          <KpiCard label="Follow-ups past due" value={summary ? summary.awaiting.follow_up_overdue.count : null} target={NO_TARGET} definition="Open follow-ups whose recorded due date has passed." href="/clinician/operations/journey#awaiting-follow_up_overdue" />
          <KpiCard
            label="Appointment attendance"
            value={rateValue(attendance, !apptFailed)}
            detail={
              apptFailed
                ? undefined
                : `${attendance.counts ? `${attendance.counts} with an outcome; ` : ""}${(appts.cancelled ?? 0).toLocaleString("en-NG")} cancelled, ${(appts.scheduledInPeriod ?? 0).toLocaleString("en-NG")} scheduled in total`
            }
            target={NO_TARGET}
            definition="Completed appointments out of completed plus no-shows, scheduled in the period. Cancellations are not counted as attendance outcomes."
            href="/clinician/appointments"
          />
        </div>
      </section>

      <section aria-labelledby="ops-existing-heading" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal-ink/5 print:hidden">
        <h2 id="ops-existing-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Workforce, capacity and SLAs</h2>
        <p className="text-sm text-charcoal-ink/65">These already exist; open them for team performance, capacity and response-time SLAs.</p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {EXISTING_PAGES.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block rounded-xl p-3 ring-1 ring-charcoal-ink/10 hover:ring-brand-green/50 focus-visible:outline-2 focus-visible:outline-brand-green">
                <span className="font-medium text-brand-green">{l.label}</span>
                <span className="block text-charcoal-ink/60">{l.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
