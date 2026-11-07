import Link from "next/link";
import { redirect } from "next/navigation";
import {
  attentionFromComplaints,
  attentionFromIncidents,
  attentionFromSafeguarding,
  attentionFromSignoffs,
  attentionFromWorklist,
  cmoOversightView,
  leadershipPeriodBounds,
  parseLeadershipPeriod,
  periodTrend,
  previousPeriodComparable,
  rankExecutiveAttention,
  ratioText,
} from "@tarragon/shared";
import { LoadFailure } from "@/components/ui/load-failure";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { loadGovernanceSignals } from "@/lib/leadership/load-governance-signals";
import { loadLeadershipKpis } from "@/lib/leadership/load-leadership-kpis";
import { loadOnLeave } from "@/lib/leadership/load-on-leave";
import { getCmoSigningHubForRequest } from "@/lib/queries/cmo-signing-hub-request";
import { getTestPatientIdsForRequest } from "@/lib/queries/real-patients-request";
import { createClient } from "@/lib/supabase/server";
import { loadDoctorWorklist } from "@/lib/worklist/doctor-worklist-load";
import { CmoOversightSection } from "../cmo-oversight-section";
import { AttentionPanel } from "./attention-panel";
import { KpiCard } from "./kpi-card";
import { PeriodSelector } from "./period-selector";
import { PrintButton } from "./print-button";

export const metadata = { title: "Clinical Leadership Overview" };

const ATTENTION_LIMIT = 10;

/**
 * The Chief Medical Officer's command centre (founder decision 2026-11-07: a new CMO-only page, and the CMO's landing page).
 * Built on what already exists: the org-wide worklist (DW-01), the CMO oversight view (DW-14), the sign-off hub, and the
 * governance tables themselves. No figure is invented or cached: each is read live under the CMO's own RLS, a failed read
 * says "could not be loaded", and a rate always shows its numerator and denominator. The CMO's role does not widen access:
 * every link opens a page with its own access check. The attention panel shows patient numbers only and no free text (no
 * escalation reason, incident or safeguarding narrative); the Clinical oversight block below is the existing DW-14 block, which
 * names patients, as it already does on the CMO's home, because the CMO acts on those rows (reassign).
 */
export default async function LeadershipOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [profile, staff] = await Promise.all([getCurrentProfile(), getCurrentClinicalStaff()]);
  if (!canAssignCases(staff)) redirect("/clinician");

  const period = parseLeadershipPeriod(params.period);
  const showAll = params.all === "1";
  const now = new Date();
  const bounds = leadershipPeriodBounds(period, now);
  const [supabase, testPatientIds] = await Promise.all([createClient(), getTestPatientIdsForRequest()]);

  const [worklist, signals, hub, onLeave, kpis] = await Promise.all([
    loadDoctorWorklist(supabase, { profileId: profile?.id ?? null, staffId: staff?.id ?? null }, testPatientIds),
    loadGovernanceSignals(supabase, testPatientIds),
    getCmoSigningHubForRequest().catch(() => null),
    loadOnLeave(supabase, now),
    loadLeadershipKpis(supabase, bounds, testPatientIds),
  ]);

  const signoffsFailed = hub === null || hub.failed;
  const signoffsWaiting = hub?.items.length ?? 0;
  const oversight = cmoOversightView(worklist.rows, worklist.failedSources, now);
  const teamFailed = worklist.failedSources.some((s) => s === "escalation" || s === "alert");

  const attention = rankExecutiveAttention([
    ...attentionFromWorklist(worklist.rows, now),
    ...attentionFromIncidents(signals.incidents ?? []),
    ...attentionFromSafeguarding(signals.safeguarding ?? []),
    ...attentionFromComplaints(signals.complaints ?? [], now),
    ...attentionFromSignoffs(signoffsWaiting),
  ]);
  const failedParts = [
    teamFailed && "clinical escalations and alerts",
    signals.incidents === null && "clinical incidents",
    signals.safeguarding === null && "safeguarding concerns",
    signals.complaints === null && "complaints",
    signoffsFailed && "the sign-off hub",
  ].filter((x): x is string => Boolean(x));

  const critical = teamFailed ? null : worklist.rows.filter((r) => (r.source === "escalation" || r.source === "alert") && r.priority === "critical").length;
  const seriousIncidents = signals.incidents ? signals.incidents.filter((i) => i.severity === "high" || i.severity === "critical").length : null;
  // A list longer than the rows drawn: say so, so the panel and the serious-incident figure are not read as complete.
  const truncated = [
    signals.incidents && signals.totals.incidents !== null && signals.totals.incidents > signals.incidents.length && "clinical incidents",
    signals.safeguarding && signals.totals.safeguarding !== null && signals.totals.safeguarding > signals.safeguarding.length && "safeguarding concerns",
    signals.complaints && signals.totals.complaints !== null && signals.totals.complaints > signals.complaints.length && "complaints",
  ].filter((x): x is string => Boolean(x));
  const comparable = previousPeriodComparable(bounds, kpis.dataSince);
  const planCoverage = ratioText(kpis.patientsWithActivePlan, kpis.patientsTotal);
  const resolvedRatio = ratioText(kpis.escalationsResolved, kpis.escalationsRaised);
  const query = (extra: Record<string, string>) => `/clinician/leadership?${new URLSearchParams({ period, ...extra }).toString()}`;

  return (
    <div className="space-y-6 print:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-green">Chief Medical Officer</p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Clinical Leadership Overview</h1>
          <p className="mt-1 text-sm text-charcoal-ink/70">
            Organisation-wide clinical performance, patient safety, quality and governance oversight.
          </p>
          <p className="mt-2 text-xs text-charcoal-ink/55">
            Updated {formatPatientDateTime(now)} (Lagos time).{" "}
            <Link href={query(showAll ? { all: "1" } : {})} className="font-medium text-brand-green underline print:hidden">
              Refresh
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector current={period} showAll={showAll} />
          <PrintButton />
        </div>
      </header>

      {failedParts.length > 0 && (
        <LoadFailure>
          Could not load {failedParts.join(", ")}. Anything from those sources is missing below, so treat this overview as
          incomplete and open those pages directly.
        </LoadFailure>
      )}

      {truncated.length > 0 && (
        <LoadFailure>
          There are more open {truncated.join(", ")} than this panel draws, so only the oldest are listed below. The counts are exact;
          open each page for the full list.
        </LoadFailure>
      )}

      <AttentionPanel
        items={attention}
        now={now}
        limit={showAll ? attention.length : ATTENTION_LIMIT}
        incomplete={failedParts.length > 0 || truncated.length > 0}
        showAllHref={showAll ? null : query({ all: "1" })}
      />

      <section aria-labelledby="live-kpi-heading" className="space-y-3">
        <div>
          <h2 id="live-kpi-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Patient safety and workload</h2>
          <p className="text-sm text-charcoal-ink/65">Live: as of now, whatever period is selected.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Critical clinical work open"
            value={critical}
            definition="Open escalations and clinical alerts at the critical level, across the whole team."
            href="/clinician/worklist?priority=critical"
          />
          <KpiCard
            label="Past response time"
            value={oversight.overdue}
            detail={oversight.overdue !== null ? `of ${oversight.teamTotal.toLocaleString("en-NG")} open team items` : undefined}
            definition="Open escalations and alerts past their governed due time (escalation SLA)."
            href="/clinician/worklist"
          />
          <KpiCard
            label="Serious incidents open"
            value={seriousIncidents}
            detail={signals.totals.incidents !== null ? `of ${signals.totals.incidents.toLocaleString("en-NG")} open clinical incidents` : undefined}
            definition="Clinical incident reports of high or critical severity that are not closed."
            href="/clinician/safety-incidents"
          />
          <KpiCard
            label="Safeguarding concerns open"
            value={signals.totals.safeguarding}
            definition="Safeguarding concerns that are open or under review."
            href="/clinician/safeguarding"
          />
          <KpiCard
            label="Waiting for your signature"
            value={signoffsFailed ? null : signoffsWaiting}
            definition="Patient-harm rules and approvals on the sign-off hub that need the CMO."
            href="/clinician/clinical-signoff"
          />
          <KpiCard
            label="Patients with an active care plan"
            value={planCoverage.pct === null ? (kpis.patientsWithActivePlan === null || kpis.patientsTotal === null ? null : "None yet") : `${planCoverage.pct}%`}
            detail={planCoverage.pct === null ? undefined : `${planCoverage.counts} patients`}
            definition="Patients with at least one care plan in status active, out of all patients (test accounts excluded)."
            href="/clinician/care-plan-review"
          />
        </div>
      </section>

      <section aria-labelledby="period-kpi-heading" className="space-y-3">
        <div>
          <h2 id="period-kpi-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Clinical activity: {bounds.label.toLowerCase()}</h2>
          <p className="text-sm text-charcoal-ink/65">
            {formatPatientDate(bounds.start)} to {formatPatientDate(bounds.end)}.{" "}
            {comparable
              ? "Compared with the previous period of the same length."
              : "No comparison is shown: the previous period starts before the platform held patient data."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="New patient registrations"
            value={kpis.registrations.current}
            trend={periodTrend(kpis.registrations.current, kpis.registrations.previous, comparable)}
            definition="Patient accounts created in the period (test accounts excluded)."
            href="/clinician/patients"
          />
          <KpiCard
            label="Consultations completed"
            value={kpis.consultationsCompleted.current}
            trend={periodTrend(kpis.consultationsCompleted.current, kpis.consultationsCompleted.previous, comparable)}
            definition="Video consultations marked completed whose end time falls in the period."
            href="/clinician/consultations-log"
          />
          <KpiCard
            label="Escalations resolved"
            value={resolvedRatio.pct === null ? (kpis.escalationsRaised === null || kpis.escalationsResolved === null ? null : "None raised") : `${resolvedRatio.pct}%`}
            detail={resolvedRatio.pct === null ? undefined : `${resolvedRatio.counts} raised in the period`}
            definition="Of the escalations raised in the period, how many are now resolved or referred."
            href="/clinician/escalations"
          />
        </div>
      </section>

      <div className="print:hidden">
        <CmoOversightSection
          rows={worklist.rows}
          failedSources={worklist.failedSources}
          now={now}
          organisationId={profile?.organisation_id ?? null}
          signoffsWaiting={signoffsWaiting}
          signoffsFailed={signoffsFailed}
          onLeave={onLeave}
        />
      </div>

      <section aria-labelledby="leadership-more-heading" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal-ink/5 print:hidden">
        <h2 id="leadership-more-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Go deeper</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/clinician/governance", label: "Governance home", note: "Every quality, safety, rules and AI page" },
            { href: "/clinician/quality", label: "Quality and safety", note: "Clinical audits and hand-backs" },
            { href: "/clinician/team-caseload", label: "Team caseload", note: "Load by doctor, reassign" },
            { href: "/clinician", label: "My clinical day", note: "Your own worklist and appointments" },
          ].map((l) => (
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
