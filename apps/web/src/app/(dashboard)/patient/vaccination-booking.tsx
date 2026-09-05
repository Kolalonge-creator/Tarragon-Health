"use client";

import type { PatientLocation } from "./facility-selector";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Vaccination-centre booking, suspended platform-wide (founder decision
 * 2026-08-03, alongside labs/pharmacy/specialist bookings — "suspend
 * everything ... until I later have partners"). No vaccination_centre
 * facility is active, so there is nothing left to select or book through.
 *
 * Deliberately not the same treatment as lab/referral self-arranged
 * fulfilment: a vaccine has to be physically administered at a real
 * location, so there is no PDF-and-go-anywhere equivalent — the patient
 * still needs a contracted, listed centre. LogVaccinationForm (recording a
 * dose already received, anywhere) is untouched and stays the only working
 * path until a partner is onboarded.
 *
 * `patientLocation` is kept as an accepted, unused prop rather than removed
 * from every call site, so re-activating this later (flip a facility row to
 * active, restore the FacilitySelector body) is a revert of this one file.
 */
export function VaccinationBooking(_props: {
  patientId: string;
  patientLocation?: PatientLocation | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Book a vaccination near you
        </CardTitle>
        <CardDescription>Booking through a vaccination centre isn&apos;t available yet.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          We haven&apos;t contracted a vaccination centre yet, so there is nowhere to book through
          the app right now. If you get a dose done elsewhere, log it below and your care team will
          see it on your record.
        </p>
      </CardContent>
    </Card>
  );
}
