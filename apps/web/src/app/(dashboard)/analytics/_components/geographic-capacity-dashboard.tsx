"use client";

import { AlertTriangle, Map as MapIcon, Stethoscope, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { useProviderCapacity, useServiceCoverage } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { NIGERIA_ZONES } from "@/lib/nigeria-zones";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function specialtyLabel(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Operations & Command Centre §96.9 — composes the existing specialist
 * provider-capacity RPC with the public state-rollout coverage RPC, grouped
 * by Nigeria's 6 geopolitical zones (client-side; no new SQL). No new data
 * source, no matching/ranking — same non-patient-facing aggregate posture
 * as CapacityDashboard (docs/CLINICAL_NETWORK_SPEC.md §3/§4.17).
 */
export function GeographicCapacityDashboard() {
  const capacity = useProviderCapacity();
  const coverage = useServiceCoverage();

  const bySpecialtyState = capacity.data?.by_specialty_state ?? [];
  const coverageRows = coverage.data ?? [];
  const isLoading = capacity.isLoading || coverage.isLoading;

  const specialties = Array.from(new Set(bySpecialtyState.map((r) => r.specialist_type))).sort();
  const coverageByState = new Map(coverageRows.map((c) => [c.state, c]));

  function activeProvidersFor(state: string, specialty: string): number {
    return (
      bySpecialtyState.find((r) => r.state === state && r.specialist_type === specialty)
        ?.active_providers ?? 0
    );
  }

  const totalActiveProviders = (capacity.data?.by_specialty ?? []).reduce(
    (sum, r) => sum + r.active_providers,
    0
  );
  const activeStates = coverageRows.filter((c) => c.is_active).length;
  const shortageCount = capacity.data?.zero_active_provider_specialties.length ?? 0;

  const exportRows = bySpecialtyState.map((r) => ({
    zone: NIGERIA_ZONES.find((z) => (z.states as readonly string[]).includes(r.state))?.label ?? "—",
    state: r.state,
    specialist_type: r.specialist_type,
    active_providers: r.active_providers,
    state_live: coverageByState.get(r.state)?.is_active ?? false,
  }));

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Provider counts are catalogue aggregates only — never a patient-facing recommendation or
        ranking (see docs/CLINICAL_NETWORK_SPEC.md §3/§4.17). &ldquo;Live&rdquo; reflects
        service_regions.is_active, the same state-rollout switch the app itself enforces.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Stethoscope} label="Active specialist providers" value={formatNumber(totalActiveProviders)} />
        <StatTile
          icon={MapIcon}
          label="States live"
          value={`${formatNumber(activeStates)} / ${formatNumber(coverageRows.length)}`}
        />
        <StatTile icon={Users} label="Specialties tracked" value={formatNumber(specialties.length)} />
        <StatTile icon={AlertTriangle} label="Specialties with zero coverage" value={formatNumber(shortageCount)} />
      </div>

      {isLoading ? (
        <SectionCard title="Capacity by zone">
          <CenterNote>Loading…</CenterNote>
        </SectionCard>
      ) : specialties.length === 0 ? (
        <SectionCard title="Capacity by zone">
          <CenterNote>No specialist providers on file.</CenterNote>
        </SectionCard>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {NIGERIA_ZONES.map((zone) => (
            <SectionCard key={zone.id} title={zone.label} description={`${zone.states.length} states`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                      <th className="py-2 pr-4 font-medium">State</th>
                      <th className="py-2 pr-4 font-medium">Live</th>
                      {specialties.map((sp) => (
                        <th key={sp} className="py-2 pr-4 text-right font-medium capitalize">
                          {specialtyLabel(sp)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {zone.states.map((state) => {
                      const live = coverageByState.get(state)?.is_active ?? false;
                      return (
                        <tr key={state} className="border-b border-charcoal-ink/5">
                          <td className="py-2 pr-4 text-charcoal-ink/80">{state}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={live ? "green" : "grey"}>{live ? "Live" : "Not live"}</Badge>
                          </td>
                          {specialties.map((sp) => {
                            const count = activeProvidersFor(state, sp);
                            return (
                              <td
                                key={sp}
                                className={`py-2 pr-4 text-right tabular-nums ${
                                  count === 0 ? "text-charcoal-ink/30" : "font-medium text-charcoal-ink"
                                }`}
                              >
                                {formatNumber(count)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      <SectionCard
        title="All zones, raw"
        description="Every specialty/state pairing with an active provider, flat and exportable."
        actions={<ExportButton filename="provider-capacity-by-zone" rows={exportRows} />}
      >
        {bySpecialtyState.length === 0 ? (
          <CenterNote>No data yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Zone</th>
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 font-medium">Specialty</th>
                  <th className="py-2 text-right font-medium">Active providers</th>
                </tr>
              </thead>
              <tbody>
                {exportRows.map((r) => (
                  <tr key={`${r.state}-${r.specialist_type}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/60">{r.zone}</td>
                    <td className="py-2 pr-4 text-charcoal-ink/80">{r.state}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">
                      {specialtyLabel(r.specialist_type)}
                    </td>
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
    </div>
  );
}
