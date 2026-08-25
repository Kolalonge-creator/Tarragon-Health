"use client";

import { useState } from "react";
import { useLabCatalogue, useOrderLabTest } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { koboToNaira } from "@tarragon/shared";

/**
 * Clinician-generated lab order — the counterpart to
 * PreventiveScreeningCalendar's due-screening self-service booking. Per the
 * clinician-originated-orders guardrail, this is the only way a patient
 * gets an ad hoc (non-screening) lab test: the patient never free-books one
 * off the catalogue directly.
 *
 * Partner-fulfilled (restored 2026-08-25): the clinician decides WHAT test is
 * needed; Tarragon routes it to Synlab Nigeria (the one active lab partner)
 * and bills the patient. No provider picker here — with a single active
 * partner there's nothing to choose — the patient picks a facility (or
 * leaves it for home collection) via ChooseLabFacility on their own
 * dashboard once the order exists.
 */
export function OrderLabTestForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: bundles, isLoading } = useLabCatalogue();
  const orderLabTest = useOrderLabTest();
  const [bundleId, setBundleId] = useState("");

  const bundle = bundles?.find((b) => b.id === bundleId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order a lab test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading catalogue…</p>}
        <div className="space-y-1.5">
          <Label htmlFor="bundle">Test / panel</Label>
          <Select id="bundle" value={bundleId} onChange={(e) => setBundleId(e.target.value)}>
            <option value="">Select a test</option>
            {(bundles ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        {bundle && (
          <p className="text-xs text-charcoal-ink/60">
            ₦{koboToNaira(bundle.price_kobo).toLocaleString()} at Synlab Nigeria. The patient pays
            Tarragon to confirm the booking.
          </p>
        )}
        {orderLabTest.isError && (
          <p className="text-sm text-red-600">
            {(orderLabTest.error as Error).message || "Could not create the order. Try again."}
          </p>
        )}
        {orderLabTest.isSuccess && (
          <p className="text-sm text-brand-green">
            Order created. The patient can confirm a facility and pay from their dashboard.
          </p>
        )}
        <Button
          disabled={!bundle || orderLabTest.isPending}
          onClick={() =>
            bundle &&
            orderLabTest.mutate({
              organisationId,
              patientId,
              panelBundleId: bundle.id,
              totalKobo: bundle.price_kobo,
            })
          }
        >
          {orderLabTest.isPending ? "Ordering…" : "Order test"}
        </Button>
      </CardContent>
    </Card>
  );
}
