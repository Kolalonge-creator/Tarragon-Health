"use client";

import { useMemo, useState } from "react";
import { useFacilities, type Facility, type FacilityWithServices } from "@/lib/queries/facilities";
import { distanceKm } from "@/lib/geo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PatientLocation = {
  state: string | null;
  city: string | null;
  area: string | null;
};

/**
 * Shared "choose a facility near me" picker: state → city → optional area, plus
 * "use my location" nearest-first sorting. Pre-fills from the patient's saved
 * profile location and emits the chosen facility (which carries its linked
 * lab_provider_id/pharmacy_partner_id) to the parent. Reused by the lab-test
 * booking (type='lab') and vaccination booking (type='vaccination_centre')
 * flows — one location model, one component.
 */
export function FacilitySelector({
  type,
  patientLocation,
  selectedFacilityId,
  onSelect,
  idPrefix = "facility",
  emptyText = "No facilities match yet — we're onboarding partners city by city.",
}: {
  type: Facility["type"];
  patientLocation?: PatientLocation | null;
  selectedFacilityId: string | null;
  onSelect: (facility: FacilityWithServices) => void;
  idPrefix?: string;
  emptyText?: string;
}) {
  const [state, setState] = useState(patientLocation?.state ?? "");
  const [city, setCity] = useState(patientLocation?.city ?? "");
  const [area, setArea] = useState(patientLocation?.area ?? "");
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const facilities = useFacilities({ type, state, city, area });

  const sorted = useMemo<FacilityWithServices[]>(() => {
    const rows = facilities.data ?? [];
    if (!nearMe) return rows;
    return [...rows].sort((a, b) => {
      const da =
        a.latitude != null && a.longitude != null
          ? distanceKm(nearMe, { lat: a.latitude, lng: a.longitude })
          : Infinity;
      const db =
        b.latitude != null && b.longitude != null
          ? distanceKm(nearMe, { lat: b.latitude, lng: b.longitude })
          : Infinity;
      return da - db;
    });
  }, [facilities.data, nearMe]);

  function handleUseMyLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("Location isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setNearMe({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setLocationError("We couldn't get your location — you can still search by state and city.")
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-state`}>State</Label>
          <Input
            id={`${idPrefix}-state`}
            placeholder="e.g. Lagos"
            value={state}
            onChange={(event) => setState(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-city`}>City</Label>
          <Input
            id={`${idPrefix}-city`}
            placeholder="e.g. Ikeja"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-area`}>Area (optional)</Label>
          <Input
            id={`${idPrefix}-area`}
            placeholder="e.g. Allen Avenue"
            value={area}
            onChange={(event) => setArea(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleUseMyLocation}>
          Use my location
        </Button>
        {nearMe && <span className="text-xs text-charcoal-ink/60">Showing nearest first</span>}
        {locationError && <span className="text-xs text-red-600">{locationError}</span>}
      </div>

      {facilities.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {facilities.isError && (
        <p className="text-sm text-red-600">Could not load facilities.</p>
      )}
      {!facilities.isLoading && !facilities.isError && sorted.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">{emptyText}</p>
      )}

      {sorted.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10 rounded-md border border-charcoal-ink/10">
          {sorted.map((facility) => {
            const isSelected = facility.id === selectedFacilityId;
            return (
              <li key={facility.id}>
                <button
                  type="button"
                  onClick={() => onSelect(facility)}
                  aria-pressed={isSelected}
                  className={`flex w-full items-start justify-between gap-2 p-3 text-left transition-colors ${
                    isSelected ? "bg-brand-green/10" : "hover:bg-charcoal-ink/5"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {facility.name}
                      {nearMe && facility.latitude != null && facility.longitude != null && (
                        <span className="ml-2 text-xs font-normal text-charcoal-ink/60">
                          {distanceKm(nearMe, {
                            lat: facility.latitude,
                            lng: facility.longitude,
                          }).toFixed(1)}{" "}
                          km away
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {[facility.area, facility.city, facility.state].filter(Boolean).join(", ")}
                      {facility.address ? ` — ${facility.address}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {facility.verified && <Badge variant="green">Verified</Badge>}
                    {isSelected && <Badge variant="blue">Selected</Badge>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
