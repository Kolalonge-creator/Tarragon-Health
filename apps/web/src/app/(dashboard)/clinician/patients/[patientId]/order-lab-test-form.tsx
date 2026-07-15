"use client";

import { useState } from "react";
import { useLabCatalogue, useLabProviders, useOrderLabTest } from "@/lib/queries/lab-orders";
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
 */
export function OrderLabTestForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: bundles, isLoading } = useLabCatalogue();
  const { data: providers } = useLabProviders();
  const orderLabTest = useOrderLabTest();
  const [bundleId, setBundleId] = useState("");
  const [providerId, setProviderId] = useState("");

  const bundle = bundles?.find((b) => b.id === bundleId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order a lab test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading catalogue…</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bundle">Test / panel</Label>
            <Select id="bundle" value={bundleId} onChange={(e) => setBundleId(e.target.value)}>
              <option value="">Select a test</option>
              {(bundles ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — ₦{koboToNaira(b.price_kobo).toLocaleString()}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider">Lab provider</Label>
            <Select id="provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Select a provider</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.regions.join(", ")}
                  {p.home_collection ? " (home collection)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {orderLabTest.isError && (
          <p className="text-sm text-red-600">
            {(orderLabTest.error as Error).message || "Could not create the order. Try again."}
          </p>
        )}
        {orderLabTest.isSuccess && (
          <p className="text-sm text-brand-green">
            Order created — the patient can complete payment from their dashboard.
          </p>
        )}
        <Button
          disabled={!bundle || !providerId || orderLabTest.isPending}
          onClick={() =>
            bundle &&
            orderLabTest.mutate({
              organisationId,
              patientId,
              panelBundleId: bundle.id,
              providerId,
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
