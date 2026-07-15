"use client";

import { useState } from "react";
import { usePharmacyCatalogue, useCreatePharmacyOrder } from "@/lib/queries/pharmacy-orders";
import { useMedications } from "@/lib/queries/medications";
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

export function PharmacyCatalogue({ organisationId, patientId }: { organisationId: string; patientId: string }) {
  const { data: medications, isLoading, isError } = usePharmacyCatalogue();
  const { data: activeMedications } = useMedications(patientId);
  const createOrder = useCreatePharmacyOrder();
  const [bookingMedicationId, setBookingMedicationId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the pharmacy catalogue.</p>}
        {medications && medications.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No medications available yet.</p>
        )}
        {medications && medications.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {medications.map((medication) => {
              const canBook = isClinicianPrescribed(medication.drug_name, activeMedications ?? []);

              return (
                <li key={medication.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">{medication.drug_name}</p>
                      {medication.pack_size && (
                        <p className="text-xs text-charcoal-ink/60">{medication.pack_size}</p>
                      )}
                      {medication.pharmacy_partner && (
                        <p className="text-xs text-charcoal-ink/60">
                          {medication.pharmacy_partner.name}
                          {medication.pharmacy_partner.delivery ? " · delivery available" : ""}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-medium text-charcoal-ink">
                      ₦{koboToNaira(medication.price_kobo).toLocaleString()}
                    </p>
                  </div>
                  {!canBook && (
                    <p className="text-xs text-charcoal-ink/70">
                      Not currently on your prescribed medications. Message your care team on
                      WhatsApp and they&apos;ll arrange it.
                    </p>
                  )}
                  {canBook &&
                    (bookingMedicationId === medication.id ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-24 space-y-1">
                          <Label htmlFor={`quantity-${medication.id}`}>Quantity</Label>
                          <Input
                            id={`quantity-${medication.id}`}
                            type="number"
                            min={1}
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={createOrder.isPending}
                          onClick={() =>
                            createOrder.mutate(
                              {
                                organisationId,
                                patientId,
                                pharmacyPartnerId: medication.pharmacy_partner_id,
                                medication,
                                quantity,
                              },
                              {
                                onSuccess: () => {
                                  setBookingMedicationId(null);
                                  setQuantity(1);
                                },
                              },
                            )
                          }
                        >
                          {createOrder.isPending ? "Booking…" : "Confirm booking"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setBookingMedicationId(null)}>
                          Cancel
                        </Button>
                        {createOrder.isError && (
                          <p className="w-full text-xs text-red-600">Could not book. Try again.</p>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBookingMedicationId(medication.id);
                          setQuantity(1);
                        }}
                      >
                        Book
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
