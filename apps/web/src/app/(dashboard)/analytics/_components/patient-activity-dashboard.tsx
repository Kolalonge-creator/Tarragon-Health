"use client";

import { useState } from "react";
import { CalendarClock, CalendarDays, LogIn, Search, ShieldAlert } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useLogPatientAccess,
  usePatientActivity,
  usePatientSearch,
} from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function fmtWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function fmtDur(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function PatientActivityDashboard() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);

  const search = usePatientSearch(submitted);
  const activity = usePatientActivity(selected?.id ?? null);
  const logAccess = useLogPatientAccess();

  const e = activity.data?.engagement;

  function selectPatient(id: string, label: string) {
    setSelected({ id, label });
    logAccess.mutate({ patientId: id, reason });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
        Identified patient lookup for dispute / compliance purposes — shows whether and when a
        patient engaged with the platform. Every lookup is recorded to the audit log with the reason
        you enter. Handle under your data-protection policy.
      </p>

      <SectionCard title="Find a patient" description="Search by patient number, name or phone.">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="pa-q">Patient (number / name / phone)</Label>
            <Input
              id="pa-q"
              value={query}
              placeholder="e.g. TH-000004"
              onChange={(ev) => setQuery(ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && setSubmitted(query.trim())}
            />
          </div>
          <div>
            <Label htmlFor="pa-reason">Reason for access (recorded)</Label>
            <Input
              id="pa-reason"
              value={reason}
              placeholder="e.g. legal review — case #..."
              onChange={(ev) => setReason(ev.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={() => setSubmitted(query.trim())} disabled={query.trim().length < 2}>
              <Search className="mr-1.5 h-4 w-4" /> Search
            </Button>
          </div>
        </div>

        {submitted.length >= 2 && (
          <div className="mt-4">
            {search.isLoading ? (
              <CenterNote>Searching…</CenterNote>
            ) : (search.data ?? []).length === 0 ? (
              <CenterNote>No matching patients.</CenterNote>
            ) : (
              <ul className="divide-y divide-charcoal-ink/5 rounded-md border border-charcoal-ink/10">
                {(search.data ?? []).map((p) => (
                  <li key={p.patient_id}>
                    <button
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-soft-sage/30 ${
                        selected?.id === p.patient_id ? "bg-soft-sage/40" : ""
                      }`}
                      onClick={() => selectPatient(p.patient_id, p.patient_number ?? p.name ?? p.patient_id)}
                    >
                      <span className="text-charcoal-ink/80">
                        <span className="font-mono text-xs text-charcoal-ink/60">{p.patient_number ?? "—"}</span>
                        {"  "}
                        {p.name ?? "(no name)"}
                      </span>
                      <span className="text-xs text-charcoal-ink/50">{p.org ?? ""} · joined {fmtWhen(p.created_at).split(",")[0]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SectionCard>

      {selected && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={LogIn} label="Login sessions" value={formatNumber(e?.total_login_sessions ?? 0)} />
            <StatTile icon={CalendarDays} label="Active days" value={formatNumber(e?.active_days ?? 0)} />
            <StatTile icon={CalendarClock} label="Activity events" value={formatNumber(e?.total_activity_events ?? 0)} />
            <StatTile
              icon={ShieldAlert}
              label="Days since last active"
              value={e?.days_since_last == null ? "—" : formatNumber(e.days_since_last)}
            />
          </div>

          <SectionCard
            title={`Engagement — ${activity.data?.patient?.name ?? selected.label}`}
            description="Whether and when this patient engaged with the platform."
          >
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              {[
                ["Patient number", activity.data?.patient?.patient_number ?? "—"],
                ["Account created", fmtWhen(activity.data?.patient?.created_at ?? null)],
                ["Onboarded", fmtWhen(activity.data?.patient?.onboarding_completed_at ?? null)],
                ["First activity", fmtWhen(e?.first_activity ?? null)],
                ["Last activity", fmtWhen(e?.last_activity ?? null)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-charcoal-ink/10 px-3 py-2">
                  <dt className="text-xs text-charcoal-ink/50">{label}</dt>
                  <dd className="text-charcoal-ink/80">{value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard
            title="Login sessions"
            description="Reconstructed from platform activity (30-min idle gap); duration is active time. Available from when platform tracking began."
            actions={<ExportButton filename={`patient-${selected.label}-sessions`} rows={activity.data?.login_sessions ?? []} />}
          >
            {activity.isLoading ? (
              <CenterNote>Loading…</CenterNote>
            ) : (activity.data?.login_sessions ?? []).length === 0 ? (
              <CenterNote>No login sessions recorded.</CenterNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                      <th className="py-2 pr-4 font-medium">Logged in</th>
                      <th className="py-2 pr-4 font-medium">Until</th>
                      <th className="py-2 pr-4 text-right font-medium">Duration</th>
                      <th className="py-2 text-right font-medium">Pageviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activity.data?.login_sessions ?? []).map((s, i) => (
                      <tr key={`${s.started}-${i}`} className="border-b border-charcoal-ink/5">
                        <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/70">{fmtWhen(s.started)}</td>
                        <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(s.ended)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums font-medium">{fmtDur(s.duration_min)}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(s.pageviews)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Activity timeline"
            description="Logins, readings logged, AI-coach use, consents, and audited actions — newest first."
            actions={<ExportButton filename={`patient-${selected.label}-activity`} rows={activity.data?.activity ?? []} />}
          >
            {activity.isLoading ? (
              <CenterNote>Loading…</CenterNote>
            ) : (activity.data?.activity ?? []).length === 0 ? (
              <CenterNote>No activity recorded for this patient.</CenterNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                      <th className="py-2 pr-4 font-medium">When</th>
                      <th className="py-2 pr-4 font-medium">Activity</th>
                      <th className="py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activity.data?.activity ?? []).map((a, i) => (
                      <tr key={`${a.occurred_at}-${i}`} className="border-b border-charcoal-ink/5">
                        <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(a.occurred_at)}</td>
                        <td className="py-2 pr-4 text-charcoal-ink/80">{a.label}</td>
                        <td className="py-2 text-xs capitalize text-charcoal-ink/50">{a.source.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
