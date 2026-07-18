"use client";

import { Building, CalendarCheck, CheckCircle2, MapPin } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useFacilityEngagement } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function FacilitiesDashboard() {
  const { data, isLoading } = useFacilityEngagement();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Building} label="Facilities" value={formatNumber(data?.total_facilities ?? 0)} />
        <StatTile icon={CheckCircle2} label="Active" value={formatNumber(data?.active_facilities ?? 0)} />
        <StatTile icon={MapPin} label="With usage" value={formatNumber(data?.facilities_with_usage ?? 0)} />
        <StatTile icon={CalendarCheck} label="Bookings" value={formatNumber(data?.total_bookings ?? 0)} />
      </div>

      <SectionCard
        title="Facility engagement"
        description="Patients served and total interactions (bookings + lab orders) per facility."
        actions={<ExportButton filename="facility-engagement" rows={data?.by_facility ?? []} />}
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.by_facility ?? []).length === 0 ? (
          <CenterNote>No facilities yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Facility</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 text-right font-medium">Users</th>
                  <th className="py-2 text-right font-medium">Interactions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_facility ?? []).map((f) => (
                  <tr key={f.facility} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/80">{f.facility}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">
                      {(f.type ?? "—").replace(/_/g, " ")}
                    </td>
                    <td className="py-2 pr-4 text-charcoal-ink/60">{f.state}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(f.users)}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(f.interactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Facilities by type"
          actions={<ExportButton filename="facilities-by-type" rows={data?.by_type ?? []} />}
        >
          <MiniBarList
            items={(data?.by_type ?? []).map((t) => ({ label: t.type, value: t.facilities }))}
            emptyLabel="No facilities yet."
          />
        </SectionCard>
        <SectionCard
          title="Facilities by state"
          actions={<ExportButton filename="facilities-by-state" rows={data?.by_state ?? []} />}
        >
          <MiniBarList
            items={(data?.by_state ?? []).map((s) => ({ label: s.state, value: s.facilities }))}
            emptyLabel="No facilities yet."
          />
        </SectionCard>
        <SectionCard
          title="Bookings by service"
          actions={<ExportButton filename="bookings-by-service" rows={data?.by_service ?? []} />}
        >
          <MiniBarList
            items={(data?.by_service ?? []).map((s) => ({ label: s.service_type, value: s.bookings }))}
            emptyLabel="No bookings yet."
          />
        </SectionCard>
      </div>
    </div>
  );
}
