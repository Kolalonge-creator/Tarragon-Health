"use client";

import { useMemo, useState } from "react";
import {
  usePharmacyCatalogue,
  useCreatePharmacyOrder,
  type PharmacyMedicationWithPartner,
} from "@/lib/queries/pharmacy-orders";
import { useMedications } from "@/lib/queries/medications";
import { distanceKm } from "@/lib/geo";
import { RegionGate } from "@/components/region-gate";
import type { PatientLocation } from "./facility-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { koboToNaira } from "@tarragon/shared";

/**
 * Per the clinician-originated-orders guardrail (see
 * docs/FULL_SPECIFICATION_V4.md), self-service ordering is limited to
 * medications a clinician already prescribed — mirrors
 * private.enforce_pharmacy_order_origin's prefix check server-side, so this
 * only decides what the UI offers; the DB trigger is the real enforcement.
 */
function isClinicianPrescribed(
  drugName: string,
  medications: { drug_name: string; source: string; is_active: boolean }[],
) {
  const normalized = drugName.toLowerCase();
  return medications.some(
    (m) => m.is_active && m.source === "clinician" && normalized.startsWith(m.drug_name.toLowerCase()),
  );
}

type Coords = { lat: number; lng: number };

/** Case-insensitive "contains" — matches the ilike filtering the facility pickers use. */
function matches(value: string | null | undefined, needle: string): boolean {
  if (!needle.trim()) return true;
  return (value ?? "").toLowerCase().includes(needle.trim().toLowerCase());
}

/** One bookable option: a specific pharmacy stocking a specific drug. */
function pharmacyDistance(
  option: PharmacyMedicationWithPartner,
  origin: Coords | null,
): number | null {
  if (!origin) return null;
  const lat = option.pharmacy_partner?.latitude;
  const lng = option.pharmacy_partner?.longitude;
  if (lat == null || lng == null) return null;
  return distanceKm(origin, { lat, lng });
}

export function PharmacyCatalogue({
  organisationId,
  patientId,
  patientLocation,
}: {
  organisationId: string;
  patientId: string;
  patientLocation?: PatientLocation | null;
}) {
  const { data: catalogue, isLoading, isError } = usePharmacyCatalogue();
  const { data: activeMedications } = useMedications(patientId);
  const createOrder = useCreatePharmacyOrder();

  const [expandedDrug, setExpandedDrug] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "denied" | "ready">("idle");
  const [filterState, setFilterState] = useState(patientLocation?.state ?? "");
  const [filterCity, setFilterCity] = useState(patientLocation?.city ?? "");
  const [filterArea, setFilterArea] = useState(patientLocation?.area ?? "");

  // Group the flat (drug, pharmacy, price) catalogue by drug so the patient
  // picks a drug first, then chooses which nearby pharmacy fulfils it.
  const drugGroups = useMemo(() => {
    const groups = new Map<string, PharmacyMedicationWithPartner[]>();
    for (const row of catalogue ?? []) {
      const p = row.pharmacy_partner;
      // Location filter: keep a pharmacy option only when its partner matches the
      // chosen state/city/area (empty filter = match all). Partners with no
      // structured location fall through the filter so they never disappear.
      const locatable = p?.state != null || p?.city != null || p?.area != null;
      if (
        locatable &&
        !(matches(p?.state, filterState) && matches(p?.city, filterCity) && matches(p?.area, filterArea))
      ) {
        continue;
      }
      const list = groups.get(row.drug_name) ?? [];
      list.push(row);
      groups.set(row.drug_name, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogue, filterState, filterCity, filterArea]);

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("denied");
      return;
    }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("ready");
      },
      () => setGeoStatus("denied"),
      { timeout: 8000 },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Location filter — narrow pharmacies to your state/city/area (pre-filled from
            your profile). "Sort by nearest" (per-drug, below) still refines by distance. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pharmacy-state">State</Label>
            <Input
              id="pharmacy-state"
              placeholder="e.g. Lagos"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pharmacy-city">City</Label>
            <Input
              id="pharmacy-city"
              placeholder="e.g. Ikeja"
              value={filterCity}
              onChange={(e) => setFilterCity(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pharmacy-area">Area (optional)</Label>
            <Input
              id="pharmacy-area"
              placeholder="e.g. Allen Avenue"
              value={filterArea}
              onChange={(e) => setFilterArea(e.target.value)}
            />
          </div>
        </div>

        <RegionGate
          state={patientLocation?.state ?? null}
          service="pharmacy"
          serviceLabel="Pharmacy ordering"
        >
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the pharmacy catalogue.</p>}
        {catalogue && catalogue.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No medications available yet.</p>
        )}
        {catalogue && catalogue.length > 0 && drugGroups.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No pharmacies match that location — try a nearby city or clear the filter.
          </p>
        )}

        {drugGroups.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {drugGroups.map(([drugName, options]) => {
              const canBook = isClinicianPrescribed(drugName, activeMedications ?? []);
              const isOpen = expandedDrug === drugName;

              // Sort pharmacy options: nearest first when we have the patient's
              // location, otherwise cheapest first. Options with no coordinates
              // sink below located ones.
              const sorted = [...options].sort((a, b) => {
                const da = pharmacyDistance(a, origin);
                const db = pharmacyDistance(b, origin);
                if (da != null && db != null) return da - db;
                if (da != null) return -1;
                if (db != null) return 1;
                return a.price_kobo - b.price_kobo;
              });

              const fromPrice = Math.min(...options.map((o) => o.price_kobo));

              return (
                <li key={drugName} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">{drugName}</p>
                      <p className="text-xs text-charcoal-ink/60">
                        {options.length} {options.length === 1 ? "pharmacy" : "pharmacies"} nearby · from ₦
                        {koboToNaira(fromPrice).toLocaleString()}
                      </p>
                    </div>
                    {!isOpen &&
                      (canBook ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setExpandedDrug(drugName);
                            setQuantity(1);
                          }}
                        >
                          Choose pharmacy
                        </Button>
                      ) : null)}
                  </div>

                  {!canBook && (
                    <p className="text-xs text-charcoal-ink/70">
                      Not currently on your prescribed medications. Message your care team on
                      WhatsApp and they&apos;ll arrange it.
                    </p>
                  )}

                  {canBook && isOpen && (
                    <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
                      {/* Fulfilment method — pickup live, delivery gated until partners onboard. */}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-brand-green px-3 py-1 font-medium text-white">
                          Pickup
                        </span>
                        <span
                          className="cursor-not-allowed rounded-full border border-charcoal-ink/20 px-3 py-1 text-charcoal-ink/40"
                          title="Home delivery is coming soon"
                        >
                          Delivery · coming soon
                        </span>
                      </div>

                      {/* Location control for nearest-first ordering. */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={requestLocation}
                          disabled={geoStatus === "loading"}
                        >
                          {geoStatus === "ready"
                            ? "Sorted by distance ✓"
                            : geoStatus === "loading"
                              ? "Locating…"
                              : "Sort by nearest to me"}
                        </Button>
                        {geoStatus === "denied" && (
                          <span className="text-xs text-charcoal-ink/60">
                            Location unavailable — showing lowest price first.
                          </span>
                        )}
                      </div>

                      <div className="w-24 space-y-1">
                        <Label htmlFor={`quantity-${drugName}`}>Quantity</Label>
                        <Input
                          id={`quantity-${drugName}`}
                          type="number"
                          min={1}
                          value={quantity}
                          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                        />
                      </div>

                      <ul className="space-y-2">
                        {sorted.map((option) => {
                          const dist = pharmacyDistance(option, origin);
                          return (
                            <li
                              key={option.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-charcoal-ink/5 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-charcoal-ink">
                                  {option.pharmacy_partner?.name ?? "Pharmacy"}
                                  {dist != null && (
                                    <span className="ml-2 text-xs font-normal text-brand-green">
                                      {dist < 1 ? "<1" : dist.toFixed(1)} km
                                    </span>
                                  )}
                                </p>
                                {(option.pharmacy_partner?.address ||
                                  option.pharmacy_partner?.city) && (
                                  <p className="truncate text-xs text-charcoal-ink/60">
                                    {option.pharmacy_partner?.address ??
                                      [option.pharmacy_partner?.area, option.pharmacy_partner?.city, option.pharmacy_partner?.state]
                                        .filter(Boolean)
                                        .join(", ")}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-charcoal-ink">
                                  ₦{koboToNaira(option.price_kobo).toLocaleString()}
                                </span>
                                <Button
                                  size="sm"
                                  disabled={createOrder.isPending}
                                  onClick={() =>
                                    createOrder.mutate(
                                      {
                                        organisationId,
                                        patientId,
                                        pharmacyPartnerId: option.pharmacy_partner_id,
                                        medication: option,
                                        quantity,
                                        fulfilmentMethod: "pickup",
                                      },
                                      {
                                        onSuccess: () => {
                                          setExpandedDrug(null);
                                          setQuantity(1);
                                        },
                                      },
                                    )
                                  }
                                >
                                  {createOrder.isPending ? "Booking…" : "Book here"}
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {createOrder.isError && (
                        <p className="text-xs text-red-600">Could not book. Try again.</p>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedDrug(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        </RegionGate>
      </CardContent>
    </Card>
  );
}
