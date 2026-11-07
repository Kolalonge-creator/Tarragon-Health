"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { LoadFailure } from "@/components/ui/load-failure";
import { cn } from "@/lib/utils";
import { useCoordinationRoster } from "@/lib/queries/coordination";
import { contactIsStale, NO_CONTACT_DAYS, paginate, type RosterRow } from "@/lib/care-coordinator/work-items";
import { useWorkspace } from "../_workspace/workspace-context";
import { formatLagosDate, formatLagosDateTime } from "../_workspace/format";

const fieldClass =
  "rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink";

function matches(r: RosterRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  return s === "" || (r.full_name ?? "").toLowerCase().includes(s) || (r.patient_number ?? "").toLowerCase().includes(s);
}

/**
 * "My patients": the patients tied to you as their coordinator, their doctor or their lead clinician. A doctor covering coordination
 * with nobody tied to them yet can switch to everyone in the organisation. Name and number only: no condition, no value.
 */
export function PatientRoster() {
  const { openPatient, covering } = useWorkspace();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useCoordinationRoster(scope);
  const now = new Date();
  const rows = (q.data ?? []).filter((r) => matches(r, search));
  const paged = paginate(rows, page);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div role="tablist" aria-label="Which patients" className="inline-flex rounded-lg border border-charcoal-ink/15 p-0.5 dark:border-night-ink/20">
          {(["mine", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => {
                setScope(s);
                setPage(1);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                scope === s ? "bg-soft-sage text-deep-forest" : "text-charcoal-ink/70 hover:text-charcoal-ink",
              )}
            >
              {s === "mine" ? "My patients" : "Everyone"}
            </button>
          ))}
        </div>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-charcoal-ink/60">
          Find a patient
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name or patient number"
            className={fieldClass}
          />
        </label>
      </div>

      {q.isError && !q.data ? (
        <LoadFailure>The patient list could not be loaded. Reload the page.</LoadFailure>
      ) : q.isLoading ? (
        <p className="text-sm text-charcoal-ink/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-charcoal-ink/15 px-4 py-8 text-center text-sm text-charcoal-ink/60">
          {search
            ? "No patient matches that search."
            : scope === "mine"
              ? covering
                ? "No patient is tied to you yet. Switch to Everyone to coordinate for the whole organisation."
                : "No patient is assigned to you as their coordinator yet. An admin assigns coordinators on the patient's care team."
              : "No patients found."}
        </p>
      ) : (
        <>
          <div className="relative hidden overflow-x-auto rounded-xl border border-charcoal-ink/10 lg:block dark:border-night-ink/15">
            <table className="w-full text-sm">
              <thead className="bg-charcoal-ink/[0.025] text-left text-xs font-semibold uppercase tracking-wider text-charcoal-ink/55">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Patient</th>
                  <th scope="col" className="px-3 py-2.5">Doctor</th>
                  <th scope="col" className="px-3 py-2.5">Coordinator</th>
                  <th scope="col" className="px-3 py-2.5">Open work</th>
                  <th scope="col" className="px-3 py-2.5">Next appointment</th>
                  <th scope="col" className="px-3 py-2.5">Last contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/[0.07]">
                {paged.rows.map((r) => (
                  <tr key={r.patient_id} className="hover:bg-charcoal-ink/[0.015]">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => openPatient(r.patient_id)}
                        className="text-left font-semibold text-charcoal-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:text-night-ink"
                      >
                        {r.full_name ?? "Patient"}
                      </button>
                      {r.patient_number && <p className="text-xs tabular-nums text-charcoal-ink/50">{r.patient_number}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-charcoal-ink/80">{r.clinician_name ?? <span className="text-charcoal-ink/45">Not assigned</span>}</td>
                    <td className="px-3 py-2.5 text-charcoal-ink/80">{r.coordinator_name ?? <span className="text-charcoal-ink/45">Not assigned</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className="tabular-nums">{r.open_items}</span>
                      {r.overdue_items > 0 && (
                        <Badge variant="amber" className="ml-2">
                          {r.overdue_items} overdue
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-charcoal-ink/75">{r.next_appointment_at ? formatLagosDateTime(r.next_appointment_at) : "None booked"}</td>
                    <td className="px-3 py-2.5">
                      {r.last_contact_at ? <span className="tabular-nums text-charcoal-ink/75">{formatLagosDate(r.last_contact_at)}</span> : <span className="text-charcoal-ink/45">Never</span>}
                      {r.last_contact_at && contactIsStale(r, now) && (
                        <span className="ml-2 text-xs text-status-attention-text" title={`No contact logged in ${NO_CONTACT_DAYS} days`}>
                          {NO_CONTACT_DAYS}d+
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 lg:hidden">
            {paged.rows.map((r) => (
              <li key={r.patient_id}>
                <button
                  type="button"
                  onClick={() => openPatient(r.patient_id)}
                  className="w-full rounded-xl border border-charcoal-ink/10 bg-white p-3 text-left dark:border-night-ink/15 dark:bg-night-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-charcoal-ink dark:text-night-ink">{r.full_name ?? "Patient"}</span>
                    {r.overdue_items > 0 && <Badge variant="amber">{r.overdue_items} overdue</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/60">
                    {r.open_items} open · next {r.next_appointment_at ? formatLagosDate(r.next_appointment_at) : "none"} · last contact{" "}
                    {r.last_contact_at ? formatLagosDate(r.last_contact_at) : "never"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {paged.pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              <button type="button" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} className="rounded-lg border border-charcoal-ink/15 px-3 py-1.5 disabled:opacity-40">
                Previous
              </button>
              <span className="tabular-nums text-charcoal-ink/60">
                Page {paged.page} of {paged.pages}
              </span>
              <button type="button" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} className="rounded-lg border border-charcoal-ink/15 px-3 py-1.5 disabled:opacity-40">
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
