"use client";

import { useState } from "react";
import { useFacilities, type Facility } from "@/lib/queries/facilities";
import { koboToNaira } from "@tarragon/shared";
import { BookingRequestForm } from "./booking-request-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function FacilityDirectory({ patientId }: { patientId: string }) {
  const [type, setType] = useState<Facility["type"] | "">("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [requestingFacilityId, setRequestingFacilityId] = useState<string | null>(null);

  const facilities = useFacilities({ type: type || undefined, state, city });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Facility directory
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="facility_type">Type</Label>
            <Select
              id="facility_type"
              value={type}
              onChange={(event) => setType(event.target.value as Facility["type"] | "")}
            >
              <option value="">All types</option>
              {Object.entries(FACILITY_TYPE_LABEL).map(([value, label]) => (
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
        </div>

        {facilities.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {facilities.isError && (
          <p className="text-sm text-red-600">Could not load the facility directory.</p>
        )}
        {!facilities.isLoading && !facilities.isError && facilities.data?.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No facilities match yet — we&apos;re onboarding partners city by city.
          </p>
        )}

        {facilities.data && facilities.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {facilities.data.map((facility) => (
              <li key={facility.id} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{facility.name}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {facility.city}, {facility.state}
                      {facility.address ? ` — ${facility.address}` : ""}
                    </p>
                    {(facility.contact_phone || facility.contact_email) && (
                      <p className="text-xs text-charcoal-ink/60">
                        {[facility.contact_phone, facility.contact_email].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <Badge variant="grey">{FACILITY_TYPE_LABEL[facility.type]}</Badge>
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
                {requestingFacilityId === facility.id ? (
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
