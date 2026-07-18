"use client";

import { Fragment, useState } from "react";
import { Clock, Stethoscope, Timer, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useDoctorPerformance } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function fmtWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function DoctorsDashboard() {
  const { data, isLoading } = useDoctorPerformance();
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const doctors = data?.by_doctor ?? [];
  const totalPatients = doctors.reduce((s, d) => s + d.patients_assigned, 0);
  const attended = doctors.reduce((s, d) => s + d.escalations_reviewed + d.alerts_acknowledged, 0);

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        De-identified for platform reporting: patient panels and the response log show patient
        numbers (PT/TH-xxxx), never names, and never the clinical response text. Full detail belongs
        in a clinical director / admin view scoped to their own organisation.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Stethoscope} label="Doctors" value={formatNumber(doctors.length)} />
        <StatTile icon={Users} label="Patients attached" value={formatNumber(totalPatients)} />
        <StatTile icon={Clock} label="Cases attended" value={formatNumber(attended)} />
        <StatTile icon={Timer} label="Responses logged" value={formatNumber(data?.recent_responses.length ?? 0)} />
      </div>

      <SectionCard
        title="Per doctor"
        description="Panel size, throughput and responsiveness. Click a row to see the (de-identified) patient panel."
        actions={
          <ExportButton
            filename="doctor-performance"
            rows={doctors.map((d) => ({
              doctor: d.doctor,
              role: d.role,
              tier: d.tier,
              patients_assigned: d.patients_assigned,
              escalations_reviewed: d.escalations_reviewed,
              alerts_acknowledged: d.alerts_acknowledged,
              meds_confirmed: d.meds_confirmed,
              reviews_completed: d.reviews_completed,
              avg_ack_minutes: d.avg_ack_minutes,
              avg_resolution_hours: d.avg_resolution_hours,
              sla_met_pct: d.sla_met_pct,
              last_active_at: d.last_active_at,
            }))}
          />
        }
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : doctors.length === 0 ? (
          <CenterNote>No doctors found.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Doctor</th>
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 text-right font-medium">Patients</th>
                  <th className="py-2 pr-4 text-right font-medium">Escalations</th>
                  <th className="py-2 pr-4 text-right font-medium">Alerts ack.</th>
                  <th className="py-2 pr-4 text-right font-medium">Avg ack</th>
                  <th className="py-2 pr-4 text-right font-medium">Avg resolve</th>
                  <th className="py-2 pr-4 text-right font-medium">SLA met</th>
                  <th className="py-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <Fragment key={d.doctor}>
                    <tr
                      className="cursor-pointer border-b border-charcoal-ink/5 hover:bg-soft-sage/30"
                      onClick={() => setOpenPanel(openPanel === d.doctor ? null : d.doctor)}
                    >
                      <td className="py-2 pr-4 text-charcoal-ink/80">{d.doctor}</td>
                      <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{d.tier ? d.tier.replace(/_/g, " ") : "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium">{formatNumber(d.patients_assigned)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(d.escalations_reviewed)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(d.alerts_acknowledged)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{d.avg_ack_minutes ? fmtMin(d.avg_ack_minutes) : "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{d.avg_resolution_hours ? `${d.avg_resolution_hours}h` : "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{d.sla_met_pct == null ? "—" : `${d.sla_met_pct}%`}</td>
                      <td className="py-2 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(d.last_active_at)}</td>
                    </tr>
                    {openPanel === d.doctor && (
                      <tr className="border-b border-charcoal-ink/5 bg-warm-ivory">
                        <td colSpan={9} className="px-4 py-3">
                          <p className="mb-2 text-xs font-medium text-charcoal-ink/60">
                            Patient panel ({d.patient_panel.length}) — de-identified
                          </p>
                          {d.patient_panel.length === 0 ? (
                            <p className="text-sm text-charcoal-ink/50">No patients assigned.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {d.patient_panel.map((pn) => (
                                <span key={pn} className="rounded-md border border-charcoal-ink/10 bg-white px-2 py-0.5 font-mono text-xs text-charcoal-ink/70">
                                  {pn}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent responses"
        description="When a case was raised, when the doctor responded, and how fast (de-identified)."
        actions={<ExportButton filename="doctor-responses" rows={data?.recent_responses ?? []} />}
      >
        {(data?.recent_responses ?? []).length === 0 ? (
          <CenterNote>No responses recorded yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Doctor</th>
                  <th className="py-2 pr-4 font-medium">Patient</th>
                  <th className="py-2 pr-4 font-medium">Response</th>
                  <th className="py-2 pr-4 font-medium">Raised</th>
                  <th className="py-2 pr-4 font-medium">Responded</th>
                  <th className="py-2 text-right font-medium">Response time</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_responses ?? []).map((r, i) => (
                  <tr key={`${r.doctor}-${r.responded_at}-${i}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/80">{r.doctor}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/60">{r.patient}</td>
                    <td className="py-2 pr-4 text-charcoal-ink/70">{r.type}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(r.raised_at)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(r.responded_at)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{fmtMin(r.response_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
