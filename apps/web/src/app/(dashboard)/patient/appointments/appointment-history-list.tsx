"use client";

import Link from "next/link";
import { useMyAppointmentHistory } from "@/lib/queries/appointments";
import { useMyVisitSummaries } from "@/lib/queries/patient-visit-summaries";
import { HISTORY_EMPTY_TEXT, type AppointmentHistoryView } from "@/lib/appointments/appointment-views";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "./appointment-labels";
import { Badge } from "@/components/ui/badge";
import { formatPatientDateTime } from "@/lib/format-date";

const MUTED = "text-xs text-charcoal-ink/60 dark:text-night-ink/60";

function formatSlot(iso: string): string {
  return formatPatientDateTime(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * P15: past, cancelled or missed appointments. A failed read says so ("Couldn't load"), never "No past appointments".
 * A past visit links to the after-visit summaries when the patient (or a supporter whose grant covers the care plan) has one. The
 * summary is not yet tied to a single appointment in the database (my_visit_summaries returns no appointment id), so the link goes to
 * the summaries list rather than claiming a summary for one particular visit.
 */
export function AppointmentHistoryList({
  patientId,
  isSelf,
  view,
}: {
  patientId: string;
  isSelf: boolean;
  view: AppointmentHistoryView;
}) {
  const history = useMyAppointmentHistory(patientId, view);

  if (history.isLoading) return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>;
  if (history.isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Couldn&apos;t load these appointments. Please refresh the page to try again.
      </p>
    );
  }
  const rows = history.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{HISTORY_EMPTY_TEXT[view]}</p>;

  return (
    <div className="space-y-3">
      {view === "past" && <VisitSummariesLink patientId={patientId} isSelf={isSelf} />}
      <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
        {rows.map((appt) => {
          const status = APPOINTMENT_STATUS_LABELS[appt.status] ?? { label: appt.status.replace(/_/g, " "), tone: "grey" as const };
          return (
            <li key={appt.id} className="flex flex-wrap items-center gap-2 py-2">
              <div>
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type.replace(/_/g, " ")}, {formatSlot(appt.scheduled_for)}
                </p>
                <p className={MUTED}>
                  {appt.clinician?.full_name ?? "Care team"} ·{" "}
                  {appt.consultation_method === "telemedicine" ? "Telemedicine" : appt.location || "In person"}
                </p>
                {view === "cancelled" && appt.payment_status === "refunded" && <p className={MUTED}>Your visit credit was returned.</p>}
              </div>
              <Badge variant={status.tone}>{status.label}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mounted on the Past view only. A supporter without the care-plan grant gets an error from the read, which only means no link. */
function VisitSummariesLink({ patientId, isSelf }: { patientId: string; isSelf: boolean }) {
  const summaries = useMyVisitSummaries(isSelf ? null : patientId);
  if ((summaries.data?.length ?? 0) === 0) return null;
  return (
    <p className="text-sm">
      <Link href="/patient/care#after-visit-summary" className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
        Read your visit summaries
      </Link>
    </p>
  );
}
