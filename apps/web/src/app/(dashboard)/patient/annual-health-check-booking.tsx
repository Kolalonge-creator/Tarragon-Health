"use client";

import { useState } from "react";
import {
  useLabCatalogue,
  useCreateLabOrder,
  usePatientLabOrders,
} from "@/lib/queries/lab-orders";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import { RegionGate } from "@/components/region-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

/**
 * One-off purchase of the Annual Health Check bundle — the prevention front
 * door, open to every patient on every plan (no entitlement gate; it's a
 * BOOK & PAY item, not a subscription feature). Books through the same
 * lab_orders pipeline as everything else: the self_bookable exception in
 * private.enforce_lab_order_origin (migration 20260723150205) is what allows
 * this one bundle through without a due screening_schedule, and abnormal
 * results still flow the standard Cat 2->1 escalation pipeline.
 */
export function AnnualHealthCheckBooking({
  patientId,
  organisationId,
  patientLocation,
}: {
  patientId: string;
  organisationId: string | null;
  patientLocation?: PatientLocation | null;
}) {
  const { data: bundles } = useLabCatalogue();
  const { data: orders } = usePatientLabOrders(patientId);
  const createOrder = useCreateLabOrder();
  const [booking, setBooking] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<FacilityWithServices | null>(null);

  const bundle = bundles?.find((b) => b.self_bookable && b.code === "annual_health_check") ?? null;
  if (!bundle || !organisationId) return null;

  const myAhcOrders = (orders ?? []).filter((o) => o.panel_bundle_id === bundle.id);
  const openOrder = myAhcOrders.find((o) =>
    ["pending_payment", "payment_confirmed", "ordered", "sample_collected", "processing"].includes(
      o.status
    )
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Annual Health Check
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          One yearly, all-round check: blood sugar (HbA1c), cholesterol, and the cancer
          screening that fits your age and sex — done at a partner lab near you, reviewed by
          a doctor. Available to everyone, on any plan.
        </p>

        {openOrder ? (
          <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2">
              <Badge variant={openOrder.status === "pending_payment" ? "amber" : "blue"}>
                {openOrder.status === "pending_payment" ? "Awaiting payment" : "In progress"}
              </Badge>
              <span className="text-xs text-charcoal-ink/60">{openOrder.order_number}</span>
            </div>
            <p className="text-sm text-charcoal-ink">
              Your check{openOrder.provider ? ` at ${openOrder.provider.name}` : ""} — ₦
              {koboToNaira(openOrder.total_kobo).toLocaleString()}
            </p>
            {openOrder.status === "pending_payment" && (
              <PayForLabOrderButton orderId={openOrder.id} amountKobo={openOrder.total_kobo} />
            )}
          </div>
        ) : (
          <RegionGate
            state={patientLocation?.state ?? null}
            service="lab"
            serviceLabel="The Annual Health Check"
          >
            {booking ? (
              <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
                <p className="text-xs font-medium text-charcoal-ink">Choose a lab near you</p>
                <FacilitySelector
                  type="lab"
                  patientLocation={patientLocation}
                  selectedFacilityId={selectedFacility?.id ?? null}
                  onSelect={setSelectedFacility}
                  idPrefix="ahc"
                  emptyText="No labs listed for that location yet — try a nearby city, or message your care team to arrange it."
                />
                {selectedFacility && !selectedFacility.lab_provider_id && (
                  <p className="text-xs text-amber-700">
                    This location can&apos;t take an online booking yet — pick another lab.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!selectedFacility?.lab_provider_id || createOrder.isPending}
                    onClick={() =>
                      createOrder.mutate(
                        {
                          organisationId,
                          patientId,
                          panelBundleId: bundle.id,
                          providerId: selectedFacility!.lab_provider_id!,
                          facilityId: selectedFacility!.id,
                          totalKobo: bundle.price_kobo,
                        },
                        {
                          onSuccess: () => {
                            setBooking(false);
                            setSelectedFacility(null);
                          },
                        }
                      )
                    }
                  >
                    {createOrder.isPending
                      ? "Booking…"
                      : `Book my check — ₦${koboToNaira(bundle.price_kobo).toLocaleString()}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBooking(false);
                      setSelectedFacility(null);
                    }}
                  >
                    Cancel
                  </Button>
                  {createOrder.isError && (
                    <p className="w-full text-xs text-red-600">Could not book. Try again.</p>
                  )}
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" onClick={() => setBooking(true)}>
                Book my check — ₦{koboToNaira(bundle.price_kobo).toLocaleString()}
              </Button>
            )}
          </RegionGate>
        )}
      </CardContent>
    </Card>
  );
}
