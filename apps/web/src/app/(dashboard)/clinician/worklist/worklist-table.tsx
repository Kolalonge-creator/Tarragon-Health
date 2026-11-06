import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { formatPatientDateTime } from "@/lib/format-date";
import {
  isOverdue,
  WORKLIST_PRIORITY_LABEL,
  WORKLIST_SOURCE_LABEL,
  type DoctorWorklistRow,
  type WorklistPriority,
} from "@tarragon/shared";

/** Priority is always a word; colour only supports it (spec 4.6, 23.1). */
export const PRIORITY_BADGE: Record<WorklistPriority, BadgeProps["variant"]> = {
  critical: "red",
  urgent: "amber",
  priority: "blue",
  not_graded: "grey",
  routine: "grey",
};

export function dueText(row: Pick<DoctorWorklistRow, "dueAt">, now: Date): string {
  if (!row.dueAt || Number.isNaN(Date.parse(row.dueAt))) return "No due time";
  return isOverdue(row, now) ? `Overdue since ${formatPatientDateTime(row.dueAt)}` : `Due ${formatPatientDateTime(row.dueAt)}`;
}

function receivedText(iso: string | null): string {
  return iso && !Number.isNaN(Date.parse(iso)) ? formatPatientDateTime(iso) : "Unknown";
}

function assignedText(row: DoctorWorklistRow): string {
  if (row.assignedToMe) return "You";
  if (row.source === "queue") return "Shared queue";
  if (row.unassigned) return "Unassigned";
  return row.assignedName ?? "Another clinician";
}

/** The owner as a phrase for the phone card ("Assigned to you", "In a shared queue", "Not yet assigned"). */
function ownerPhrase(row: DoctorWorklistRow): string {
  if (row.assignedToMe) return "Assigned to you";
  if (row.source === "queue") return "In a shared queue";
  if (row.unassigned) return "Not yet assigned";
  return `Assigned to ${row.assignedName ?? "another clinician"}`;
}

function PatientCell({ row }: { row: DoctorWorklistRow }) {
  return (
    <>
      <Link href={`/clinician/patients/${row.patientId}`} className="font-medium text-charcoal-ink hover:underline">
        {row.patientName ?? "Unnamed patient"}
      </Link>
      <span className="block text-xs text-charcoal-ink/60">{row.patientNumber ?? "No Tarragon number"}</span>
    </>
  );
}

function ActionLink({ row }: { row: DoctorWorklistRow }) {
  return (
    <Link
      href={row.href}
      className="inline-flex min-h-11 items-center rounded-lg border border-brand-green/40 px-3 text-sm font-medium text-brand-green hover:bg-brand-green/5 focus-visible:outline-2 focus-visible:outline-brand-green"
    >
      {row.nextAction}
    </Link>
  );
}

/**
 * The named worklist (DW-01). A table on wide screens, stacked cards on narrow ones; both show priority, patient
 * name and number, the issue, timing, owner, status and the next action, so nothing essential is hidden on a phone.
 */
export function WorklistTable({ rows, now }: { rows: readonly DoctorWorklistRow[]; now: Date }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl bg-white md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Patients requiring attention, most urgent first</caption>
          <thead className="border-b border-charcoal-ink/10 text-xs uppercase tracking-wide text-charcoal-ink/60">
            <tr>
              <th scope="col" className="px-4 py-3">Priority</th>
              <th scope="col" className="px-4 py-3">Patient</th>
              <th scope="col" className="px-4 py-3">Clinical issue</th>
              <th scope="col" className="px-4 py-3">Received</th>
              <th scope="col" className="px-4 py-3">Due</th>
              <th scope="col" className="px-4 py-3">Assigned to</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-ink/10">
            {rows.map((row) => {
              const overdue = isOverdue(row, now);
              return (
                <tr key={row.key} className="align-top">
                  <td className="px-4 py-3">
                    <Badge variant={PRIORITY_BADGE[row.priority]}>{WORKLIST_PRIORITY_LABEL[row.priority]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <PatientCell row={row} />
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    {row.issue}
                    <span className="block text-xs text-charcoal-ink/60">{WORKLIST_SOURCE_LABEL[row.source]}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-charcoal-ink/80">{receivedText(row.receivedAt)}</td>
                  <td className={overdue ? "px-4 py-3 font-medium tabular-nums text-red-700" : "px-4 py-3 tabular-nums text-charcoal-ink/80"}>
                    {dueText(row, now)}
                  </td>
                  <td className="px-4 py-3">{assignedText(row)}</td>
                  <td className="px-4 py-3">{row.status}</td>
                  <td className="px-4 py-3">
                    <ActionLink row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Patients requiring attention, most urgent first">
        {rows.map((row) => {
          const overdue = isOverdue(row, now);
          return (
            <li key={row.key} className="space-y-2 rounded-2xl bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={PRIORITY_BADGE[row.priority]}>{WORKLIST_PRIORITY_LABEL[row.priority]}</Badge>
                <span className="text-xs text-charcoal-ink/60">
                  {WORKLIST_SOURCE_LABEL[row.source]} · {row.status}
                </span>
              </div>
              <div>
                <PatientCell row={row} />
              </div>
              <p>{row.issue}</p>
              <p className={overdue ? "font-medium text-red-700" : "text-charcoal-ink/70"}>
                {dueText(row, now)} · {ownerPhrase(row)}
              </p>
              <ActionLink row={row} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
