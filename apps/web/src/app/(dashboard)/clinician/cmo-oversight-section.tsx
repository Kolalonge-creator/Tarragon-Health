import Link from "next/link";
import { cmoOversightView, figure, type DoctorWorklistRow, type WorklistSource } from "@tarragon/shared";
import { LoadFailure } from "@/components/ui/load-failure";
import { TodayStrip } from "./today-strip";
import { WorklistTable } from "./worklist/worklist-table";
import { OverdueHandoversBlock, type OpenHandover } from "./handover-lists";

export type OnLeaveDoctor = { name: string; until: string };

function untilText(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/**
 * DW-14 (founder, 2026-11-06): the Chief Medical Officer's "Clinical oversight" block on the same home every doctor sees.
 * Built from the org-wide worklist rows the page already loaded, the sign-off hub the layout already read for its banner,
 * and today's leave. A figure from a read that failed says so; it is never shown as 0.
 */
export function CmoOversightSection({
  rows,
  failedSources,
  now,
  organisationId,
  signoffsWaiting,
  signoffsFailed,
  onLeave,
  overdueHandovers,
}: {
  rows: readonly DoctorWorklistRow[];
  failedSources: readonly WorklistSource[];
  now: Date;
  organisationId: string | null;
  signoffsWaiting: number;
  signoffsFailed: boolean;
  /** Null when the leave read failed. */
  onLeave: OnLeaveDoctor[] | null;
  /** G10 (DW-18): waiting handovers past their answer-by time. Null when the read failed. */
  overdueHandovers: OpenHandover[] | null;
}) {
  const view = cmoOversightView(rows, failedSources, now);

  return (
    <section aria-labelledby="oversight-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="oversight-heading" className="font-heading text-lg font-semibold text-charcoal-ink">
          Clinical oversight
        </h2>
        <Link href="/clinician/team-caseload" className="text-sm font-medium text-brand-green underline">
          Team caseload
        </Link>
      </div>

      <TodayStrip
        label="Oversight figures"
        tiles={[
          { label: "Overdue across the team", figure: figure(view.overdue, view.overdue === null), href: "/clinician/worklist", note: "past their due time" },
          { label: "Not assigned", figure: figure(view.unassigned, view.unassigned === null), href: "/clinician/worklist", note: "no doctor yet" },
          { label: "Waiting for your signature", figure: figure(signoffsWaiting, signoffsFailed), href: "/clinician/clinical-signoff", note: "sign-off items" },
          { label: "On leave today", figure: figure(onLeave?.length ?? null, onLeave === null), href: "/clinician/team-caseload", note: "clinicians away now" },
        ]}
      />

      {failedSources.some((s) => s === "escalation" || s === "alert") && (
        <LoadFailure>Part of the team&apos;s work could not be loaded, so this view is incomplete. Reload the page.</LoadFailure>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 text-sm lg:col-span-1">
          <h3 className="mb-2 font-medium text-charcoal-ink">Open work by doctor</h3>
          {view.byDoctor.length === 0 ? (
            <p className="text-charcoal-ink/60">No assigned open work.</p>
          ) : (
            <ul className="space-y-1">
              {view.byDoctor.map((d) => (
                <li key={d.name} className="flex justify-between gap-2">
                  <span>{d.name}</span>
                  <span className="tabular-nums text-charcoal-ink/70">
                    {d.open} open
                    {d.overdue > 0 && <span className="ml-2 font-medium text-red-700">{d.overdue} overdue</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {onLeave && onLeave.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 font-medium text-charcoal-ink">On leave</h3>
              <ul className="space-y-1 text-charcoal-ink/80">
                {onLeave.map((d) => (
                  <li key={`${d.name}:${d.until}`}>
                    {d.name}, back {untilText(d.until)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-3 lg:col-span-2">
          <OverdueHandoversBlock handovers={overdueHandovers} />
          {view.teamRows.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-charcoal-ink/70">
              {failedSources.length > 0 ? "Nothing to show from the work that did load. This is not an all-clear." : "No open team work right now."}
            </p>
          ) : (
            <>
              <WorklistTable
                rows={view.teamRows}
                now={now}
                caption="Team work, overdue first"
                assignOrganisationId={organisationId ?? undefined}
              />
              {view.teamTotal > view.teamRows.length && (
                <p className="mt-2 text-sm text-charcoal-ink/70">
                  Showing {view.teamRows.length} of {view.teamTotal}.{" "}
                  <Link href="/clinician/worklist" className="font-medium text-brand-green underline">
                    Open the full worklist
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
