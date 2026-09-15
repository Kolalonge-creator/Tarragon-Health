"use client";

import { useState } from "react";
import { useSpecialistProviderPerformance, useSpecialistProviderWorkload } from "@/lib/queries/specialist-provider-network";

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

/** 66.8 workload dashboard + 66.9 performance, computed from specialist_referrals — see the workload/performance migration for why patient satisfaction and punctuality are surfaced as untracked rather than fabricated. */
export function SpecialistWorkloadPerformancePanel({ specialistProviderId }: { specialistProviderId: string }) {
  const [open, setOpen] = useState(false);
  const { data: workload, isLoading: workloadLoading } = useSpecialistProviderWorkload(
    open ? specialistProviderId : ""
  );
  const { data: performance, isLoading: performanceLoading } = useSpecialistProviderPerformance(
    open ? specialistProviderId : ""
  );

  if (!open) {
    return (
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(true)}>
        View workload & performance
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3">
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(false)}>
        Hide workload & performance
      </button>
      {workloadLoading || performanceLoading ? (
        <p className="text-xs text-charcoal-ink/60">Loading…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 rounded border border-charcoal-ink/10 p-2 text-xs">
            <p className="font-medium text-charcoal-ink/70">Workload</p>
            <p>Consultations today: {workload?.consultations_today ?? 0}</p>
            <p className="pl-2 text-charcoal-ink/60">
              Telemedicine: {workload?.consultations_telemedicine_today ?? 0} · Physical:{" "}
              {workload?.consultations_physical_today ?? 0}
            </p>
            <p>
              Average waiting time (90d): {workload?.avg_waiting_days_90d != null ? `${workload.avg_waiting_days_90d} days` : "—"}
            </p>
            <p>Cancellation rate (90d): {pct(workload?.cancellation_rate_90d)}</p>
            <p className="text-charcoal-ink/50">Referrals (90d): {workload?.referrals_90d ?? 0}</p>
          </div>
          <div className="space-y-1 rounded border border-charcoal-ink/10 p-2 text-xs">
            <p className="font-medium text-charcoal-ink/70">Performance</p>
            <p>Referral completion rate: {pct(performance?.referral_completion_rate)}</p>
            <p className="pl-2 text-charcoal-ink/60">
              {performance?.referrals_completed ?? 0} completed / {performance?.referrals_declined ?? 0} declined
              of {performance?.referrals_total ?? 0} total
            </p>
            <p>
              Avg. report turnaround:{" "}
              {performance?.avg_report_turnaround_days != null ? `${performance.avg_report_turnaround_days} days` : "—"}
            </p>
            <p className="text-charcoal-ink/40">
              Patient satisfaction: not yet tracked for referral-network specialists. Punctuality: not yet
              tracked (no check-in timestamp exists on referrals today).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
