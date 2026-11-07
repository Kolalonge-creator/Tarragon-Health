import Link from "next/link";
import { redirect } from "next/navigation";
import { AWAITING_META, journeyStages, medianText, timeOutstanding, type JourneyAwaitingKey } from "@tarragon/shared";
import { LoadFailure } from "@/components/ui/load-failure";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadJourneyExceptions, type JourneyException } from "@/lib/clinical-operations/load-journey-exceptions";
import { loadJourneySummary } from "@/lib/clinical-operations/load-journey-summary";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { getTestPatientIdsForRequest } from "@/lib/queries/real-patients-request";
import { createClient } from "@/lib/supabase/server";
import { JourneyPipeline } from "../pipeline";

export const metadata = { title: "Patient Journey" };

const AWAITING_ORDER: JourneyAwaitingKey[] = [
  "follow_up_overdue",
  "doctor_review",
  "investigation_result",
  "care_plan_approval",
  "onboarding",
  "no_coordinator",
  "follow_up_open",
];

const MEDIANS = [
  { key: "registered_to_onboarded", label: "Registration to onboarding completed" },
  { key: "ordered_to_resulted", label: "Lab order to result" },
  { key: "uploaded_to_reviewed", label: "Result uploaded to doctor review" },
  { key: "follow_up_raised_to_closed", label: "Follow-up raised to closed" },
] as const;

/**
 * Patient Journey Performance (CMO Clinical Operations, 2026-11-07). Org-wide stage counts, waits and median times come from the
 * CMO-only aggregate (no identities). The exceptions list below is read under the CMO's own access, so it holds only patients the
 * CMO is tied to, by patient number; the page says so, so a short list is never mistaken for the whole picture.
 */
export default async function PatientJourneyPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const now = new Date();
  const [supabase, testPatientIds] = await Promise.all([createClient(), getTestPatientIdsForRequest()]);
  const [summary, exceptions] = await Promise.all([loadJourneySummary(supabase), loadJourneyExceptions(supabase, now, testPatientIds)]);
  const stages = summary ? journeyStages(summary) : null;

  const lists: { title: string; rows: JourneyException[] | null }[] = [
    { title: "Follow-ups past their due date", rows: exceptions.followUpsOverdue },
    { title: "Results waiting for a doctor's review", rows: exceptions.awaitingReview },
    { title: "Lab orders waiting for a result", rows: exceptions.awaitingResult },
  ];
  const exceptionRows = lists.flatMap((l) => l.rows ?? []);
  const failedLists = lists.filter((l) => l.rows === null).map((l) => l.title.toLowerCase());
  if (exceptions.numbersFailed) failedLists.push("patient numbers");

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <Link href="/clinician/operations" className="text-sm font-medium text-brand-green underline">Clinical Operations</Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Patient Journey</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Where every patient stands, from registration to follow-up, and where they are waiting. Care continues after the last step,
          and not every patient needs every investigation, so a stage someone has not reached is not counted as a failure.
        </p>
        <p className="mt-2 text-xs text-charcoal-ink/55">
          {summary ? `As of ${formatPatientDateTime(summary.generatedAt)} (Lagos time). Organisation-wide, test accounts excluded.` : "Organisation-wide figures could not be loaded."}
        </p>
      </header>

      {!summary && <LoadFailure>The organisation-wide journey figures could not be loaded. They are unknown, not zero.</LoadFailure>}

      {stages && (
        <section aria-labelledby="journey-stages-heading" className="space-y-3">
          <h2 id="journey-stages-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Stages</h2>
          <JourneyPipeline stages={stages} />
          <div className="overflow-x-auto rounded-2xl bg-white p-4 ring-1 ring-charcoal-ink/5">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">Journey stages with their definitions</caption>
              <thead className="border-b border-charcoal-ink/10 text-xs uppercase tracking-wide text-charcoal-ink/55">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Stage</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Patients</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Of registered patients</th>
                  <th scope="col" className="py-2 font-medium">What is counted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/5">
                {stages.map((s) => (
                  <tr key={s.key}>
                    <th scope="row" className="py-2 pr-3 font-medium text-charcoal-ink">{s.label}</th>
                    <td className="py-2 pr-3 tabular-nums">{s.reached.toLocaleString("en-NG")}</td>
                    <td className="py-2 pr-3 tabular-nums text-charcoal-ink/75">{s.ofRegistered ? `${s.ofRegistered.pct}% (${s.ofRegistered.text})` : "Not applicable"}</td>
                    <td className="py-2 text-charcoal-ink/65">{s.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {summary && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="journey-waiting-heading" className="rounded-2xl bg-white p-5 ring-1 ring-charcoal-ink/5">
            <h2 id="journey-waiting-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Waiting now</h2>
            <p className="text-sm text-charcoal-ink/65">Organisation-wide counts and the oldest wait. No target is approved, so none is marked late except a follow-up past its own due date.</p>
            <ul className="mt-3 divide-y divide-charcoal-ink/10 text-sm">
              {AWAITING_ORDER.map((key) => {
                const a = summary.awaiting[key];
                const meta = AWAITING_META[key];
                return (
                  <li key={key} id={`awaiting-${key}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="text-charcoal-ink">{meta.label}</span>
                    <span className="flex items-baseline gap-3">
                      <span className="font-semibold tabular-nums text-charcoal-ink">{a.count.toLocaleString("en-NG")}</span>
                      {a.oldest_days !== null && a.count > 0 && <span className="text-xs text-charcoal-ink/55">oldest {a.oldest_days} day{a.oldest_days === 1 ? "" : "s"}</span>}
                      <Link href={meta.href} className="text-xs font-medium text-brand-green underline">{meta.action}</Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="journey-medians-heading" className="rounded-2xl bg-white p-5 ring-1 ring-charcoal-ink/5">
            <h2 id="journey-medians-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Median time between stages</h2>
            <p className="text-sm text-charcoal-ink/65">Half took longer, half took less. Steps completed in the last 365 days.</p>
            <dl className="mt-3 divide-y divide-charcoal-ink/10 text-sm">
              {MEDIANS.map((m) => (
                <div key={m.key} className="flex justify-between gap-3 py-2">
                  <dt className="text-charcoal-ink">{m.label}</dt>
                  <dd className="tabular-nums text-charcoal-ink/80">{medianText(summary.median_hours[m.key]) ?? "No completed example yet"}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}

      <section aria-labelledby="journey-exceptions-heading" className="space-y-3">
        <div>
          <h2 id="journey-exceptions-heading" className="font-heading text-lg font-semibold text-charcoal-ink">Patients you can open</h2>
          <p className="text-sm text-charcoal-ink/65">
            Oldest first, by patient number. Follow-ups and results are for patients you are on the care team for or otherwise currently
            responsible for; the counts above cover everyone, because the Chief Medical Officer role does not open every record. Lab
            orders are visible to all staff, so that list covers the whole organisation and opens the orders page rather than a record.
          </p>
        </div>
        {failedLists.length > 0 && <LoadFailure>Could not load {failedLists.join(", ")}. This list is incomplete.</LoadFailure>}
        {exceptionRows.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-charcoal-ink/70">
            {failedLists.length > 0 ? "Nothing to show from the lists that loaded." : "None of your patients is waiting on these steps."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white p-4 ring-1 ring-charcoal-ink/5">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">Journey exceptions for patients you can open</caption>
              <thead className="border-b border-charcoal-ink/10 text-xs uppercase tracking-wide text-charcoal-ink/55">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Patient</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Outstanding</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Since</th>
                  <th scope="col" className="py-2 font-medium">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/5">
                {exceptionRows
                  .slice()
                  .sort((a, b) => a.since.localeCompare(b.since))
                  .map((r) => (
                    <tr key={r.key}>
                      <td className="py-2 pr-3">
                        <Link href={r.href} className="font-medium text-brand-green underline">{r.patientNumber ?? (r.kind === "investigation_result" ? "Open orders" : "Open record")}</Link>
                      </td>
                      <td className="py-2 pr-3 text-charcoal-ink">{r.label}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-charcoal-ink/75">{formatPatientDate(r.since)}</td>
                      <td className="whitespace-nowrap py-2 text-charcoal-ink/75">{timeOutstanding(r.since, now) ?? "Unknown"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
