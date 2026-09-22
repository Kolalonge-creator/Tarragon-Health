"use client";

import { Fragment, useMemo, useState } from "react";
import { Briefcase, PiggyBank, Stethoscope, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useDoctorIncome, useDoctorPaidJobs } from "@/lib/analytics/queries";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";
import type { DoctorIncomeByDoctor, DoctorPaidJob } from "@/lib/analytics/schemas";

function fmtWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—";
}

/** UTC-based month boundaries — close enough for a monthly commission
 * review; not attempting a full Africa/Lagos-aware cutover for a handful of
 * hours either side of midnight on the 1st. */
type PeriodPreset = "all" | "this_month" | "last_month";

function periodRange(preset: PeriodPreset): { from?: string; to?: string; label: string } {
  const now = new Date();
  if (preset === "all") return { label: "All time" };
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (preset === "this_month") {
    const from = new Date(Date.UTC(y, m, 1));
    const label = from.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
    return { from: from.toISOString(), label };
  }
  // last_month
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const label = from.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
  return { from: from.toISOString(), to: to.toISOString(), label };
}

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

function attributionBadge(attribution: DoctorPaidJob["attribution"]) {
  if (attribution === "attributed") return <Badge variant="green">Attributed</Badge>;
  if (attribution === "unattributed") return <Badge variant="amber">Unattributed</Badge>;
  return <Badge variant="grey">No single job</Badge>;
}

function DoctorDetail({ doctor }: { doctor: DoctorIncomeByDoctor }) {
  const jobs = useDoctorPaidJobs({ doctorProfileId: doctor.doctor_profile_id });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-charcoal-ink/10 bg-white px-3 py-2 dark:border-night-ink/15 dark:bg-night-card">
          <p className="text-xs text-charcoal-ink/50">Total income</p>
          <p className="text-lg font-semibold tabular-nums text-clinical-navy">
            {formatMinor(doctor.revenue_minor, doctor.currency ?? "NGN")}
          </p>
        </div>
        <div className="rounded-md border border-charcoal-ink/10 bg-white px-3 py-2 dark:border-night-ink/15 dark:bg-night-card">
          <p className="text-xs text-charcoal-ink/50">Paid jobs</p>
          <p className="text-lg font-semibold tabular-nums text-clinical-navy">
            {formatNumber(doctor.jobs)}
          </p>
        </div>
        <div className="rounded-md border border-charcoal-ink/10 bg-white px-3 py-2 dark:border-night-ink/15 dark:bg-night-card">
          <p className="text-xs text-charcoal-ink/50">Distinct patients</p>
          <p className="text-lg font-semibold tabular-nums text-clinical-navy">
            {formatNumber(doctor.patients)}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-charcoal-ink/60">By service</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                <th className="py-1.5 pr-4 font-medium">Service</th>
                <th className="py-1.5 pr-4 text-right font-medium">Jobs</th>
                <th className="py-1.5 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {doctor.by_product.map((p) => (
                <tr key={p.product_code} className="border-b border-charcoal-ink/5">
                  <td className="py-1.5 pr-4 text-charcoal-ink/80">{p.product_name}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{formatNumber(p.jobs)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatMinor(p.revenue_minor, doctor.currency ?? "NGN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-charcoal-ink/60">Paid jobs, most recent first</p>
          <ExportButton
            filename={`${doctor.doctor.replace(/\s+/g, "-").toLowerCase()}-paid-jobs`}
            rows={(jobs.data ?? []).map((j) => ({
              product: j.product_name,
              patient_number: j.patient_number,
              earned_at: j.earned_at,
              revenue_minor: j.revenue_minor,
              currency: j.currency,
              source: j.source,
              work_status: j.work_status,
            }))}
          />
        </div>
        {jobs.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (jobs.data ?? []).length === 0 ? (
          <CenterNote>No paid jobs in this period.</CenterNote>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border border-charcoal-ink/10 dark:border-night-ink/15">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-warm-ivory dark:bg-night-card">
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-1.5 pr-4 pl-3 font-medium">Service</th>
                  <th className="py-1.5 pr-4 font-medium">Patient</th>
                  <th className="py-1.5 pr-4 font-medium">Earned</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(jobs.data ?? []).map((j) => (
                  <tr key={`${j.source}-${j.source_id}`} className="border-b border-charcoal-ink/5">
                    <td className="py-1.5 pr-4 pl-3 text-charcoal-ink/80">{j.product_name}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs text-charcoal-ink/60">
                      {j.patient_number ?? "—"}
                    </td>
                    <td className="py-1.5 pr-4 whitespace-nowrap text-charcoal-ink/60">
                      {fmtWhen(j.earned_at)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatMinor(j.revenue_minor, j.currency ?? "NGN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function DoctorIncomeDashboard() {
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const range = useMemo(() => periodRange(preset), [preset]);
  const { data, isLoading } = useDoctorIncome({ from: range.from, to: range.to });
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);

  const doctors = data?.by_doctor ?? [];
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Every paid job attributed to the doctor who did it — the catalogue prices every service
        as a piece of a doctor&apos;s time (see <code>service_delivery_cost_model</code>). This is a
        reporting tool for working out commission at the end of a period; it does not calculate,
        store, or pay one — no commission rate exists on the platform yet.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-charcoal-ink/60">Period:</span>
        <Select
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value as PeriodPreset);
            setSelectedDoctorId(null);
          }}
          className="h-8 w-auto py-1"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        {preset !== "all" && <span className="text-xs text-charcoal-ink/50">{range.label}</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={PiggyBank}
          label="Total revenue"
          value={formatMinor(totals?.revenue_minor ?? 0, "NGN")}
        />
        <StatTile icon={Briefcase} label="Paid jobs" value={formatNumber(totals?.jobs ?? 0)} />
        <StatTile icon={Stethoscope} label="Doctors credited" value={formatNumber(totals?.doctors ?? 0)} />
        <StatTile
          icon={Users}
          label="Attributed to a doctor"
          value={
            totals && totals.jobs > 0
              ? `${Math.round((totals.attributed_jobs / totals.jobs) * 100)}%`
              : "—"
          }
        />
      </div>

      <SectionCard
        title="Revenue by source"
        description="This report normalises three different money rails into one list. This is why its total can differ from /analytics/financial (which only sees the first)."
        actions={<ExportButton filename="doctor-income-by-source" rows={data?.by_source ?? []} />}
      >
        <MiniBarList
          items={(data?.by_source ?? []).map((s) => ({
            label: s.source,
            value: s.revenue_minor,
            display: `${formatMinor(s.revenue_minor, "NGN")} · ${formatNumber(s.jobs)} jobs`,
          }))}
          emptyLabel="No paid work in this period."
        />
      </SectionCard>

      <SectionCard
        title="Income by doctor"
        description="Select a doctor to see their total income for the period and every paid job behind it."
        actions={
          <ExportButton
            filename="doctor-income"
            rows={doctors.map((d) => ({
              doctor: d.doctor,
              tier: d.tier,
              employment_type: d.employment_type,
              jobs: d.jobs,
              patients: d.patients,
              revenue_minor: d.revenue_minor,
              currency: d.currency,
              first_job_at: d.first_job_at,
              last_job_at: d.last_job_at,
            }))}
          />
        }
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : doctors.length === 0 ? (
          <CenterNote>No paid work attributed to a doctor in this period.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Doctor</th>
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 text-right font-medium">Jobs</th>
                  <th className="py-2 pr-4 text-right font-medium">Patients</th>
                  <th className="py-2 pr-4 text-right font-medium">Income</th>
                  <th className="py-2 font-medium">Last job</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <Fragment key={d.doctor_profile_id}>
                    <tr
                      className="cursor-pointer border-b border-charcoal-ink/5 hover:bg-soft-sage/30"
                      onClick={() =>
                        setSelectedDoctorId(
                          selectedDoctorId === d.doctor_profile_id ? null : d.doctor_profile_id
                        )
                      }
                    >
                      <td className="py-2 pr-4 text-charcoal-ink/80">
                        {d.doctor}
                        {!d.active && (
                          <span className="ml-2">
                            <Badge variant="grey">Inactive</Badge>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 capitalize text-charcoal-ink/60">
                        {d.tier ? d.tier.replace(/_/g, " ") : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(d.jobs)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(d.patients)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium">
                        {formatMinor(d.revenue_minor, d.currency ?? "NGN")}
                      </td>
                      <td className="py-2 whitespace-nowrap text-charcoal-ink/60">
                        {fmtDate(d.last_job_at)}
                      </td>
                    </tr>
                    {selectedDoctorId === d.doctor_profile_id && (
                      <tr className="border-b border-charcoal-ink/5 bg-warm-ivory dark:bg-night-card">
                        <td colSpan={6} className="px-4 py-4">
                          <DoctorDetail doctor={d} />
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
        title="Paid work with no single doctor"
        description="Money collected that this period's total includes but no doctor is individually credited with — an unspent credit, a term of standing cover (e.g. Continuous Monitoring) expected to contain several reviews, or a job nobody is recorded against yet. Not a gap in this report; a fact about what was actually sold."
        actions={
          <ExportButton filename="doctor-income-unattributed" rows={data?.unattributed ?? []} />
        }
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.unattributed ?? []).length === 0 ? (
          <CenterNote>Every paid job in this period is credited to a doctor.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Service</th>
                  <th className="py-2 pr-4 text-right font-medium">Jobs</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(data?.unattributed ?? []).map((u) => (
                  <tr
                    key={`${u.attribution}-${u.product_code}`}
                    className="border-b border-charcoal-ink/5"
                  >
                    <td className="py-2 pr-4">{attributionBadge(u.attribution)}</td>
                    <td className="py-2 pr-4 text-charcoal-ink/80">
                      {u.product_name}
                      {u.expected_jobs != null && u.expected_jobs !== 1 && (
                        <span className="ml-1.5 text-xs text-charcoal-ink/50">
                          (~{u.expected_jobs} reviews expected)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(u.jobs)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMinor(u.revenue_minor, "NGN")}
                    </td>
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
