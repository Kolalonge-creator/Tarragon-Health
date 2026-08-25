"use client";

import { useState } from "react";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import { useSetLabOrderFacility } from "@/lib/queries/lab-orders";
import { Button } from "@/components/ui/button";

/**
 * Restored 2026-08-25 alongside partner-lab fulfilment. Closes the one gap
 * left in the "pick a lab near you" flow: a clinician-ordered test
 * (useOrderLabTest) has no facility_id at all, unlike a self-service booking
 * which can be paid and left on home collection with no facility chosen.
 * Optional rather than required to proceed: Synlab's home_collection covers
 * every state, so this is "pick a specific branch instead" trigged by the
 * patient, not a blocker before payment.
 */
export function ChooseLabFacility({
  orderId,
  patientId,
  patientLocation,
  onChosen,
}: {
  orderId: string;
  patientId: string;
  patientLocation?: PatientLocation | null;
  onChosen?: () => void;
}) {
  const [selectedFacility, setSelectedFacility] = useState<FacilityWithServices | null>(null);
  const setFacility = useSetLabOrderFacility();

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs font-medium text-charcoal-ink">Choose a lab near you, or leave it for home collection</p>
      <FacilitySelector
        type="lab"
        patientLocation={patientLocation}
        selectedFacilityId={selectedFacility?.id ?? null}
        onSelect={setSelectedFacility}
        idPrefix={`order-${orderId}`}
        emptyText="No labs listed for that location yet; try a nearby city, or message your care team to arrange it."
      />
      {selectedFacility && !selectedFacility.lab_provider_id && (
        <p className="text-xs text-amber-700">This location can&apos;t take an online booking yet, pick another lab.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!selectedFacility?.lab_provider_id || setFacility.isPending}
          onClick={() =>
            setFacility.mutate(
              { orderId, facilityId: selectedFacility!.id, patientId },
              { onSuccess: () => onChosen?.() }
            )
          }
        >
          {setFacility.isPending ? "Saving…" : "Confirm lab"}
        </Button>
        {setFacility.isError && <p className="w-full text-xs text-red-600">Could not save. Try again.</p>}
      </div>
    </div>
  );
}
