"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadFailure } from "@/components/ui/load-failure";
import { useCoordinationWorkItems, usePatientContext } from "@/lib/queries/coordination";
import { CATEGORY_LABEL, STATUS_LABEL, isOverdue, workItemHref } from "@/lib/care-coordinator/work-items";
import { useWorkspace } from "./workspace-context";
import { workItemTitle } from "./work-item-labels";
import { formatLagosDateTime } from "./format";

const APPT_LABEL: Record<string, string> = {
  telemedicine: "Doctor meeting",
  result_interpretation: "Results meeting",
  dietitian: "Dietitian",
  pharmacist: "Pharmacist",
};

/**
 * The right-hand context panel: enough to coordinate without leaving the list, and nothing clinical. No diagnosis, value or clinical
 * note is shown (minimum necessary); the full record is one link away, and opening it there is audited.
 */
export function PatientDrawer() {
  const { panelPatientId, closePatient } = useWorkspace();
  const ctx = usePatientContext(panelPatientId);
  const items = useCoordinationWorkItems();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelPatientId) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePatient();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [panelPatientId, closePatient]);

  if (!panelPatientId) return null;
  const now = new Date();
  const open = (items.data ?? []).filter((i) => i.patient_id === panelPatientId);
  const name = ctx.data?.patient?.full_name ?? "Patient";

  return (
    <div className="fixed inset-0 z-50 print:hidden" role="presentation">
      <button type="button" aria-label="Close the patient panel" tabIndex={-1} className="absolute inset-0 bg-charcoal-ink/30" onClick={closePatient} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${name}: coordination summary`}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-charcoal-ink/10 bg-white shadow-2xl dark:border-night-ink/15 dark:bg-night-card"
      >
        <div className="flex items-start justify-between gap-3 border-b border-charcoal-ink/10 px-5 py-4 dark:border-night-ink/15">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-ink/45">Patient</p>
            <h2 className="truncate font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">{ctx.isLoading ? "Loading…" : name}</h2>
            {ctx.data?.patient?.patient_number && <p className="text-sm tabular-nums text-charcoal-ink/60">{ctx.data.patient.patient_number}</p>}
          </div>
          <button
            type="button"
            data-drawer-close
            onClick={closePatient}
            aria-label="Close"
            className="rounded-md p-1.5 text-charcoal-ink/55 hover:bg-charcoal-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-6 px-5 py-4 text-sm">
          {ctx.isError && <LoadFailure>This patient&rsquo;s summary could not be loaded. Close the panel and try again.</LoadFailure>}

          <section aria-labelledby="drawer-team">
            <h3 id="drawer-team" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
              Care team
            </h3>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
              <dt className="text-charcoal-ink/55">Doctor</dt>
              <dd>{ctx.data?.careTeam?.clinician?.full_name ?? <span className="text-charcoal-ink/50">Not assigned</span>}</dd>
              <dt className="text-charcoal-ink/55">Coordinator</dt>
              <dd>{ctx.data?.careTeam?.coordinator?.full_name ?? <span className="text-charcoal-ink/50">Not assigned</span>}</dd>
            </dl>
          </section>

          <section aria-labelledby="drawer-open">
            <h3 id="drawer-open" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
              Open coordination work ({open.length})
            </h3>
            {items.isError && !items.data ? (
              <p className="text-charcoal-ink/60">Could not be loaded.</p>
            ) : open.length === 0 ? (
              <p className="text-charcoal-ink/60">Nothing open for this patient.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {open.map((i) => (
                  <li key={i.item_id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={workItemHref(i)} className="font-medium text-charcoal-ink hover:underline dark:text-night-ink">
                        {workItemTitle(i)}
                      </Link>
                      <p className="text-xs text-charcoal-ink/55">
                        {CATEGORY_LABEL[i.category]} · {i.assigned_name ?? "Unassigned"}
                      </p>
                    </div>
                    <Badge variant={isOverdue(i, now) ? "amber" : "grey"}>{isOverdue(i, now) ? "Overdue" : STATUS_LABEL[i.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="drawer-appts">
            <h3 id="drawer-appts" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
              Next appointments
            </h3>
            {(ctx.data?.nextAppointments ?? []).length === 0 ? (
              <p className="text-charcoal-ink/60">{ctx.isLoading ? "Loading…" : "None booked."}</p>
            ) : (
              <ul className="space-y-1">
                {ctx.data?.nextAppointments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span>{APPT_LABEL[a.appointment_type] ?? a.appointment_type.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-charcoal-ink/70">{formatLagosDateTime(a.scheduled_for)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="drawer-contacts">
            <h3 id="drawer-contacts" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
              Recent contact
            </h3>
            {(ctx.data?.contacts ?? []).length === 0 ? (
              <p className="text-charcoal-ink/60">{ctx.isLoading ? "Loading…" : "No contact logged."}</p>
            ) : (
              <ul className="space-y-2">
                {ctx.data?.contacts.map((c) => (
                  <li key={c.id}>
                    <p className="tabular-nums text-xs text-charcoal-ink/55">{formatLagosDateTime(c.contacted_at)}</p>
                    {c.note && <p className="line-clamp-2 text-charcoal-ink/80">{c.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-charcoal-ink/10 px-5 py-4 dark:border-night-ink/15">
          <Link
            href={`/clinician/patients/${panelPatientId}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white hover:bg-deep-forest"
          >
            Open the record <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/dashboard/care-coordinator/book-for-patient"
            className="inline-flex items-center rounded-lg border border-charcoal-ink/15 px-3 py-2 text-sm font-medium text-charcoal-ink hover:bg-charcoal-ink/[0.03] dark:border-night-ink/20 dark:text-night-ink"
          >
            Book for this patient
          </Link>
        </div>
      </div>
    </div>
  );
}
