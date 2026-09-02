"use client";

import { useMemo, useState } from "react";
import { useLabCatalogue, useOrderLabTest, usePatientLabOrders } from "@/lib/queries/lab-orders";
import { duplicateInvestigationFindings } from "@/lib/rules/lab-order-safety";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { koboToNaira } from "@tarragon/shared";
import type { Database } from "@tarragon/shared";

type Urgency = Database["public"]["Enums"]["lab_order_urgency"];

/**
 * Clinician-generated lab order — the counterpart to
 * PreventiveScreeningCalendar's due-screening self-service booking. Per the
 * clinician-originated-orders guardrail, this is the only way a patient
 * gets an ad hoc (non-screening) lab test: the patient never free-books one
 * off the catalogue directly.
 *
 * Self-arranged: the clinician decides WHAT test is needed and why; Tarragon
 * does not route the sample to a partner lab or take payment for it. The
 * patient takes the order to whichever lab suits them and uploads the result.
 * No provider is chosen here because there is no partner to choose.
 *
 * Module 57.3/57.5/57.7/57.9: a clinical indication and urgency are recorded
 * on every order (private.enforce_lab_order_origin rejects a missing
 * indication server-side, this is not just a UI nicety), a duplicate-
 * investigation check runs against the patient's own recent orders before
 * submitting (advisory only — it never blocks the order), and the selected
 * bundle's preparation instructions, if any, are shown once an order exists.
 */
export function OrderLabTestForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: bundles, isLoading } = useLabCatalogue();
  const { data: recentOrders } = usePatientLabOrders(patientId);
  const orderLabTest = useOrderLabTest();
  const [bundleId, setBundleId] = useState("");
  const [clinicalIndication, setClinicalIndication] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("routine");

  const bundle = bundles?.find((b) => b.id === bundleId) ?? null;

  const duplicateFindings = useMemo(() => {
    if (!bundle || !recentOrders) return [];
    return duplicateInvestigationFindings(
      recentOrders.map((o) => ({
        id: o.id,
        testCodes: o.panel_bundle?.test_codes ?? [],
        orderedAt: o.ordered_at,
        status: o.status,
        panelBundleName: o.panel_bundle?.name ?? null,
      })),
      bundle.test_codes,
    );
  }, [bundle, recentOrders]);

  const canSubmit = !!bundle && clinicalIndication.trim().length > 0 && !orderLabTest.isPending;

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
            Roughly ₦{koboToNaira(bundle.price_kobo).toLocaleString()} at a typical Nigerian lab, as
            a guide only. The patient pays the lab directly and Tarragon takes nothing on it.
          </p>
        )}
        {bundle?.preparation_instructions && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
            {bundle.preparation_instructions}
          </p>
        )}
        {duplicateFindings.length > 0 && (
          <div className="space-y-1.5">
            {duplicateFindings.map((finding) => (
              <p
                key={finding.testCode}
                className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900"
              >
                <span className="font-medium">{finding.title}.</span> {finding.message}
              </p>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="clinical-indication">Clinical indication</Label>
          <Textarea
            id="clinical-indication"
            value={clinicalIndication}
            onChange={(e) => setClinicalIndication(e.target.value)}
            placeholder={'Why this investigation is needed, e.g. "Follow-up HbA1c, dose adjusted 6 weeks ago."'}
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="urgency">Urgency</Label>
          <Select id="urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </Select>
        </div>
        {orderLabTest.isError && (
          <p className="text-sm text-red-600">
            {(orderLabTest.error as Error).message || "Could not create the order. Try again."}
          </p>
        )}
        {orderLabTest.isSuccess && (
          <p className="text-sm text-brand-green">
            Order created. The patient can download the request from their dashboard, take it to any
            lab, and upload the result for you to review.
          </p>
        )}
        <Button
          disabled={!canSubmit}
          onClick={() =>
            bundle &&
            orderLabTest.mutate(
              {
                organisationId,
                patientId,
                panelBundleId: bundle.id,
                clinicalIndication: clinicalIndication.trim(),
                urgency,
              },
              {
                onSuccess: () => {
                  setBundleId("");
                  setClinicalIndication("");
                  setUrgency("routine");
                },
              },
            )
          }
        >
          {orderLabTest.isPending ? "Ordering…" : "Order test"}
        </Button>
      </CardContent>
    </Card>
  );
}
