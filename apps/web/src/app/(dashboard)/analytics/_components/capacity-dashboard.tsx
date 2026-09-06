"use client";

import { AlertTriangle, Clock, Stethoscope, Users, Video } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { useProviderCapacity } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function specialtyLabel(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Ops-facing rollup of specialist-network capacity (docs/CLINICAL_NETWORK_SPEC.md
 * §4.17). Deliberately not patient-facing and not a matching/ranking surface —
 * it counts and aggregates the existing catalogue and waitlist, same as
 * useWaitlistedReferrals' live per-referral count, just rolled up org-wide for
 * ops rather than per-case for a clinician assigning a referral.
 */
export function CapacityDashboard() {
  const { data, isLoading } = useProviderCapacity();

  const bySpecialty = data?.by_specialty ?? [];
  const totalActiveProviders = bySpecialty.reduce((s, r) => s + r.active_providers, 0);
  const totalWaitlisted = bySpecialty.reduce((s, r) => s + r.waitlisted_referrals, 0);
  const shortageCount = data?.zero_active_provider_specialties.length ?? 0;
  const videoUtil = data?.video_slot_utilisation_next_7_days;
  const videoUtilPct =
    videoUtil && videoUtil.total_slots > 0
      ? Math.round((videoUtil.booked_slots / videoUtil.total_slots) * 100)
      : null;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Provider counts and waitlist aggregates only, never a patient-facing recommendation or
        ranking. See docs/CLINICAL_NETWORK_SPEC.md §3/§4.17.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Stethoscope} label="Active specialist providers" value={formatNumber(totalActiveProviders)} />
        <StatTile icon={Users} label="Referrals waitlisted" value={formatNumber(totalWaitlisted)} />
        <StatTile
          icon={AlertTriangle}
          label="Specialties with zero coverage"
          value={formatNumber(shortageCount)}
        />
        <StatTile
          icon={Video}
          label="Video slots booked (next 7d)"
          value={videoUtilPct == null ? "—" : `${videoUtilPct}%`}
        />
      </div>

      {shortageCount > 0 && (
        <SectionCard title="Zero-coverage specialties" description="No active provider on the catalogue at all.">
          <div className="flex flex-wrap gap-1.5">
            {data?.zero_active_provider_specialties.map((s) => (
              <Badge key={s} variant="red">
                {specialtyLabel(s)}
              </Badge>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Capacity by specialty"
        description="Active providers vs. the catalogue total, current waitlist size, and average current wait for whoever is still waiting."
        actions={<ExportButton filename="provider-capacity-by-specialty" rows={bySpecialty} />}
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : bySpecialty.length === 0 ? (
          <CenterNote>No specialist providers on file.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Specialty</th>
                  <th className="py-2 pr-4 text-right font-medium">Active</th>
                  <th className="py-2 pr-4 text-right font-medium">Total on catalogue</th>
                  <th className="py-2 pr-4 text-right font-medium">Waitlisted now</th>
                  <th className="py-2 text-right font-medium">Avg current wait</th>
                </tr>
              </thead>
              <tbody>
                {bySpecialty.map((r) => (
                  <tr key={r.specialist_type} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {specialtyLabel(r.specialist_type)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium">
                      {formatNumber(r.active_providers)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-charcoal-ink/60">
                      {formatNumber(r.total_providers)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {r.waitlisted_referrals > 0 ? (
                        <Badge variant="amber">{formatNumber(r.waitlisted_referrals)}</Badge>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-charcoal-ink/60">
                      {r.avg_current_wait_hours == null ? "—" : `${r.avg_current_wait_hours}h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Capacity by specialty and state"
        description="Where active provider coverage actually sits, geographically."
        actions={<ExportButton filename="provider-capacity-by-state" rows={data?.by_specialty_state ?? []} />}
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.by_specialty_state.length ?? 0) === 0 ? (
          <CenterNote>No data yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Specialty</th>
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 text-right font-medium">Active providers</th>
                </tr>
              </thead>
              <tbody>
                {data?.by_specialty_state.map((r) => (
                  <tr key={`${r.specialist_type}-${r.state}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {specialtyLabel(r.specialist_type)}
                    </td>
                    <td className="py-2 pr-4 text-charcoal-ink/70">{r.state}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {formatNumber(r.active_providers)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard
          title="Recent booking turnaround"
          description="For referrals that actually got booked in the last 90 days."
        >
          {data?.recent_booking_turnaround ? (
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-charcoal-ink/40" strokeWidth={2} />
              <div>
                <p className="text-2xl font-semibold tabular-nums text-charcoal-ink">
                  {data.recent_booking_turnaround.avg_hours_to_booking == null
                    ? "—"
                    : `${data.recent_booking_turnaround.avg_hours_to_booking}h`}
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  average, across {formatNumber(data.recent_booking_turnaround.booked_referrals)} booked
                  referrals
                </p>
              </div>
            </div>
          ) : (
            <CenterNote>No data yet.</CenterNote>
          )}
        </SectionCard>

        <SectionCard
          title="Tarragon video-consult slots"
          description="Own care-team capacity (not the external specialist network) for the next 7 days."
        >
          {videoUtil ? (
            <div className="flex items-center gap-3">
              <Video className="h-5 w-5 text-charcoal-ink/40" strokeWidth={2} />
              <div>
                <p className="text-2xl font-semibold tabular-nums text-charcoal-ink">
                  {formatNumber(videoUtil.booked_slots)} / {formatNumber(videoUtil.total_slots)}
                </p>
                <p className="text-xs text-charcoal-ink/60">slots booked</p>
              </div>
            </div>
          ) : (
            <CenterNote>No data yet.</CenterNote>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
