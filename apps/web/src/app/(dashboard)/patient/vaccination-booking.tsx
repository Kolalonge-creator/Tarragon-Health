"use client";

import { useState } from "react";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import { BookingRequestForm } from "./booking-request-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * "Book a vaccination near you" — pick a vaccination centre by state/city/area
 * (or "use my location"), then send a booking request they confirm directly.
 * Reuses the shared FacilitySelector + the existing BookingRequestForm /
 * booking_requests path (a request, not a real-time booking — same low-tech
 * shape as the facility directory). Additive to LogVaccinationForm, which stays
 * for recording shots already received.
 */
export function VaccinationBooking({
  patientId,
  patientLocation,
}: {
  patientId: string;
  patientLocation?: PatientLocation | null;
}) {
  const [selectedFacility, setSelectedFacility] = useState<FacilityWithServices | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Book a vaccination near you
        </CardTitle>
        <CardDescription>
          Find a vaccination centre in your area and send a booking request — they&apos;ll
          confirm the date with you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FacilitySelector
          type="vaccination_centre"
          patientLocation={patientLocation}
          selectedFacilityId={selectedFacility?.id ?? null}
          onSelect={setSelectedFacility}
          idPrefix="vax"
          emptyText="No vaccination centres listed for that location yet — try a nearby city."
        />
        {selectedFacility && (
          <>
            <BookingRequestForm
              patientId={patientId}
              facility={selectedFacility}
              onDone={() => setSelectedFacility(null)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedFacility(null)}
            >
              Choose a different centre
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
