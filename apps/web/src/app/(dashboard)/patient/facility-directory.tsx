"use client";

import { useMemo, useState } from "react";
import { useFacilities, type Facility, type FacilityWithServices } from "@/lib/queries/facilities";
import { distanceKm } from "@/lib/geo";
import { koboToNaira } from "@tarragon/shared";
import { BookingRequestForm } from "./booking-request-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";

const FACILITY_TYPE_LABEL: Record<Facility["type"], string> = {
  hospital: "Hospital",
  lab: "Lab",
  pharmacy: "Pharmacy",
  radiology: "Radiology",
  optician: "Optician",
  vaccination_centre: "Vaccination centre",
};

// 'pharmacy' stays out of the filter dropdown (not the lookup map above, so a
// pre-existing row still renders a correct badge): medication is collected
// wherever the patient likes and recorded afterwards, so an open-ended booking
// request to a specific pharmacy is not a path we offer.
//
// 'lab' is now IN the dropdown. It used to be excluded because lab tests booked
// transactionally through the catalogue; under self-arranged fulfilment there is
// no booking to make, so the only useful thing we can offer is "here are labs
// people use, go to whichever suits you". Labs are listed for reference only —
// see LAB_LISTING_NOTE and the verified-badge suppression below.
const SELECTABLE_FACILITY_TYPES = Object.entries(FACILITY_TYPE_LABEL).filter(
  ([value]) => value !== "pharmacy",
);

/**
 * Deliberate wording: "commonly used", never "trusted", "approved" or
 * "recommended". Tarragon has not audited any of these laboratories, and
 * claiming otherwise to a patient choosing where to have blood taken would be a
 * representation we cannot stand behind. Accreditation checking (MLSCN
 * registration and similar) is a real piece of ops work, not a copy change.
 */
const LAB_LISTING_NOTE =
  "These are laboratories people commonly use. We have not inspected or accredited them, and we earn nothing if you go to one, so please use whichever lab you trust or your doctor suggests.";

/**
 * "Find near me" discovery view (docs/FULL_SPECIFICATION_V4.md §2.3 — "a
 * patient-facing 'find near me' view ... distinct from the transactional
 * booking flow"). Reads public.facilities directly (now carrying
 * latitude/longitude/hours/verified — see 20260715162815_care_navigation_directory_columns.sql)
 * rather than a separate directory table, so there's one directory, not two.
 * Booking stays as a secondary action per facility, same as before — this
 * is still fundamentally a browse/discover view, not a booking form.
 */
export function FacilityDirectory({ patientId }: { patientId: string }) {
  const [type, setType] = useState<Facility["type"] | "">("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [requestingFacilityId, setRequestingFacilityId] = useState<string | null>(null);
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const facilities = useFacilities({ type: type || undefined, state, city, area });

  const sorted = useMemo<FacilityWithServices[]>(() => {
    const rows = facilities.data ?? [];
    if (!nearMe) return rows;
    return [...rows].sort((a, b) => {
      const da = a.latitude != null && a.longitude != null
        ? distanceKm(nearMe, { lat: a.latitude, lng: a.longitude })
        : Infinity;
      const db = b.latitude != null && b.longitude != null
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
      () => setLocationError("We couldn't get your location; you can still search by state and city.")
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Care navigation
        </CardTitle>
        <CardDescription>
          Find a lab, vaccination centre, hospital, or specialist near you. Labs are listed for
          reference so you can take your test request somewhere convenient; you are free to use any
          lab, listed here or not.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={handleUseMyLocation}>
            Use my location
          </Button>
          {nearMe && <span className="text-xs text-charcoal-ink/60">Showing nearest first</span>}
          {locationError && <span className="text-xs text-red-600">{locationError}</span>}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="facility_type">Type</Label>
            <Select
              id="facility_type"
              value={type}
              onChange={(event) => setType(event.target.value as Facility["type"] | "")}
            >
              <option value="">All types</option>
              {SELECTABLE_FACILITY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facility_state">State</Label>
            <Input
              id="facility_state"
              placeholder="e.g. Lagos"
              value={state}
              onChange={(event) => setState(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facility_city">City</Label>
            <Input
              id="facility_city"
              placeholder="e.g. Ikeja"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facility_area">Area (optional)</Label>
            <Input
              id="facility_area"
              placeholder="e.g. Allen Avenue"
              value={area}
              onChange={(event) => setArea(event.target.value)}
            />
          </div>
        </div>

        {facilities.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {facilities.isError && (
          <p className="text-sm text-red-600">Could not load the facility directory.</p>
        )}
        {!facilities.isLoading && !facilities.isError && sorted.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No facilities match yet; we&apos;re onboarding partners city by city.
          </p>
        )}

        {sorted.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {sorted.map((facility) => (
              <li key={facility.id} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {facility.name}
                      {nearMe && facility.latitude != null && facility.longitude != null && (
                        <span className="ml-2 text-xs font-normal text-charcoal-ink/60">
                          {distanceKm(nearMe, { lat: facility.latitude, lng: facility.longitude }).toFixed(1)} km away
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {facility.city}, {facility.state}
                      {facility.address ? `, ${facility.address}` : ""}
                    </p>
                    {facility.hours && (
                      <p className="text-xs text-charcoal-ink/60">Hours: {facility.hours}</p>
                    )}
                    {(facility.contact_phone || facility.contact_email) && (
                      <p className="text-xs text-charcoal-ink/60">
                        {[facility.contact_phone, facility.contact_email].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="grey">{FACILITY_TYPE_LABEL[facility.type]}</Badge>
                    {/* No "Verified" claim on a laboratory: facilities.verified
                        is seeded true wholesale and reflects no actual
                        inspection, so on the one listing a patient uses to
                        choose where blood is drawn it would be a false
                        assurance. See LAB_LISTING_NOTE. */}
                    {facility.verified && facility.type !== "lab" && (
                      <Badge variant="green">Verified</Badge>
                    )}
                  </div>
                </div>
                {facility.facility_services.length > 0 && (
                  <ul className="space-y-1 rounded-md bg-charcoal-ink/5 p-2">
                    {facility.facility_services.map((service) => (
                      <li key={service.id} className="flex justify-between text-xs text-charcoal-ink/70">
                        <span>{service.name}</span>
                        {service.price_kobo != null && (
                          <span>₦{koboToNaira(service.price_kobo).toLocaleString()}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/* A lab needs no booking from us: the patient takes their test
                    request straight there and pays the lab. Offering to "book"
                    it would promise a coordination step that does not happen. */}
                {facility.type === "lab" ? (
                  <p className="text-xs text-charcoal-ink/60">{LAB_LISTING_NOTE}</p>
                ) : requestingFacilityId === facility.id ? (
                  <BookingRequestForm
                    patientId={patientId}
                    facility={facility}
                    onDone={() => setRequestingFacilityId(null)}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRequestingFacilityId(facility.id)}
                  >
                    Request a booking
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
