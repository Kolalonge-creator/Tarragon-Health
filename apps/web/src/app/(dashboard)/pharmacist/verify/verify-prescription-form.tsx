"use client";

import { useState, type FormEvent } from "react";
import {
  useVerifyPrescription,
  type PrescriptionVerification,
} from "@/lib/queries/prescription-verification";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATUS_BADGE: Record<string, { variant: "green" | "grey" | "amber" | "blue"; label: string }> = {
  active: { variant: "green", label: "Active" },
  expired: { variant: "amber", label: "Expired" },
  cancelled: { variant: "grey", label: "Cancelled" },
  superseded: { variant: "blue", label: "Superseded (a newer version exists)" },
};

/**
 * Spec §62.7 prescription verification — any pharmacy, not only a
 * contracted partner (Tarragon has none live). Reads the rx_number +
 * verification_code a patient's prescription shows and confirms
 * authenticity, medication detail, quantity, and validity via
 * public.verify_prescription() (20260829011500_verify_prescription.sql) —
 * gated to role=pharmacist server-side, not just by this page's own layout.
 */
export function VerifyPrescriptionForm() {
  const verify = useVerifyPrescription();
  const [rxNumber, setRxNumber] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<PrescriptionVerification | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    verify.mutate(
      { rxNumber: rxNumber.trim(), verificationCode: code.trim() },
      { onSuccess: (data) => setResult(data) }
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Verify a prescription</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rx_number">Rx number</Label>
              <Input
                id="rx_number"
                placeholder="TRG-RX-2026-000123"
                value={rxNumber}
                onChange={(event) => setRxNumber(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verification_code">Verification code</Label>
              <Input
                id="verification_code"
                placeholder="From the prescription"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-40"
                required
              />
            </div>
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending ? "Checking…" : "Verify"}
            </Button>
          </form>
          {verify.isError && (
            <p className="mt-2 text-sm text-red-600">
              {(verify.error as Error).message || "Could not verify this prescription."}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.drug_name}
              <Badge variant={STATUS_BADGE[result.status]?.variant ?? "grey"}>
                {STATUS_BADGE[result.status]?.label ?? result.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Patient" value={result.patient_name} />
              <Row label="Prescriber" value={result.prescriber_name} />
              <Row label="Dose" value={result.dose} />
              <Row label="Frequency" value={result.frequency} />
              <Row label="Route" value={result.route} />
              <Row label="Quantity" value={result.quantity} />
              <Row
                label="Duration"
                value={result.duration_days ? `${result.duration_days} day(s)` : undefined}
              />
              <Row
                label="Repeats"
                value={`${result.repeats_used} of ${result.repeats_allowed} used`}
              />
              <Row label="Indication" value={result.indication} />
              <Row label="Instructions" value={result.instructions} />
              <Row
                label="Signed"
                value={new Date(result.signed_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
              <Row
                label="Valid until"
                value={
                  result.expires_at
                    ? new Date(result.expires_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : undefined
                }
              />
              <Row label="Version" value={`v${result.version}`} />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-charcoal-ink/50">{label}</dt>
      <dd className="text-charcoal-ink">{value}</dd>
    </div>
  );
}
