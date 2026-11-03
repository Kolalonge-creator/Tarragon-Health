import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CONSULTATION_STATUSES,
  filtersToQuery,
  lagosTime,
  mediaLabel,
  statusLabel,
  totalsOf,
  type ConsultationsLogFilters,
  type ConsultationsLogRow,
} from "@/lib/consultations/consultations-log";
import type { DoctorOption } from "@/lib/consultations/load-consultations-log";

interface Props {
  /** The page's own path, which the filter form submits to. */
  basePath: string;
  backTo: { href: string; label: string };
  /** Where a patient name links: the admin member page or the clinician patient record. */
  patientHref: (patientId: string) => string;
  filters: ConsultationsLogFilters;
  doctors: readonly DoctorOption[];
  /** Null when the log could not be read. */
  rows: readonly ConsultationsLogRow[] | null;
}

const fmtMinutes = (n: number | null) => (n === null ? "—" : n.toFixed(1));

/**
 * The consultations log table, shared by /admin/consultations and the CMO's /clinician/consultations-log. The filters are a
 * plain GET form so a filtered view is a link; the CSV link carries the same query string.
 */
export function ConsultationsLogView({ basePath, backTo, patientHref, filters, doctors, rows }: Props) {
  const query = filtersToQuery(filters);
  const totals = rows ? totalsOf(rows) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consultations log"
        backTo={backTo}
        description="Every consultation in the organisation: when it was booked for, the patient, the doctor, what happened, and how long it ran. Doctor minutes run from the doctor joining to pressing Finish. Connected minutes are what Zoom reports for the meeting, added up when the call dropped and was rejoined. Times are Lagos time."
      />

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} className="rounded border border-charcoal-ink/20 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} className="rounded border border-charcoal-ink/20 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Doctor
          <select name="doctor" defaultValue={filters.doctor ?? ""} className="rounded border border-charcoal-ink/20 px-2 py-1">
            <option value="">Any doctor</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className="rounded border border-charcoal-ink/20 px-2 py-1">
            <option value="">Any status</option>
            {CONSULTATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1">
          <input type="checkbox" name="tests" value="1" defaultChecked={filters.includeTests} />
          Include test calls
        </label>
        <button type="submit" className="rounded bg-brand-green px-3 py-1.5 font-medium text-white hover:opacity-90">
          Show
        </button>
        <a
          href={`/api/consultations-log/export${query ? `?${query}` : ""}`}
          className="pb-1.5 font-medium text-brand-green hover:underline"
        >
          Download CSV
        </a>
      </form>

      {rows === null ? (
        <p role="alert" className="text-sm">
          The consultations log could not be loaded. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          No consultations match these filters.{filters.includeTests ? "" : " Test calls are hidden unless you tick Include test calls."}
        </p>
      ) : (
        <Card>
          <CardContent className="pt-4">
            {totals && (
              <p className="mb-3 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {totals.calls} {totals.calls === 1 ? "consultation" : "consultations"} · {totals.doctorMinutes.toFixed(1)} doctor minutes ·{" "}
                {totals.connectedMinutes.toFixed(1)} connected minutes
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Booked for</th>
                    <th className="py-2 pr-4">Patient</th>
                    <th className="py-2 pr-4">Doctor</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Doctor minutes</th>
                    <th className="py-2 pr-4 text-right">Connected minutes</th>
                    <th className="py-2 pr-4 text-right">Joins (patient / doctor)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-ink/5">
                  {rows.map((r) => (
                    <tr key={r.encounter_id}>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.call_date}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{lagosTime(r.scheduled_at)}</td>
                      <td className="py-2 pr-4">
                        <Link href={patientHref(r.patient_id)} className="font-medium text-brand-green hover:underline">
                          {r.patient_name || "Patient"}
                        </Link>
                        {r.is_test && (
                          <Badge variant="grey" className="ml-2">
                            Test
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4">{r.clinician_name || "Not assigned"}</td>
                      <td className="py-2 pr-4">
                        {statusLabel(r.status)}
                        {r.media_mode && r.media_mode !== "video" ? ` · ${mediaLabel(r.media_mode)}` : ""}
                      </td>
                      <td className="py-2 pr-4 text-right">{fmtMinutes(r.doctor_minutes)}</td>
                      <td className="py-2 pr-4 text-right">
                        {fmtMinutes(r.connected_minutes)}
                        {r.zoom_legs > 1 ? ` (${r.zoom_legs} parts)` : ""}
                        {r.zoom_open_legs > 0 ? " · still connected" : ""}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {r.patient_joins} / {r.clinician_joins}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
