"use client";

import { useActionState, useId, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmFhirProposedResource,
  dismissFhirProposedResource,
  type FhirReviewDecisionState,
} from "./actions";

export interface ProposedFhirResource {
  id: string;
  resource_type: "Observation" | "AllergyIntolerance" | "MedicationStatement" | "MedicationRequest" | "Immunization";
  status: string;
  fhir_resource_id: string | null;
  normalized_payload: Record<string, unknown>;
  parse_warnings: string[] | null;
  proposed_at: string;
  patient: { full_name: string | null; patient_number: string | null } | null;
  batch: { source_system: string | null; received_at: string } | null;
}

const RESOURCE_TYPE_LABEL: Record<ProposedFhirResource["resource_type"], string> = {
  Observation: "Vital reading",
  AllergyIntolerance: "Allergy",
  MedicationStatement: "Medication (statement)",
  MedicationRequest: "Medication (request)",
  Immunization: "Immunisation",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function payloadSummary(item: ProposedFhirResource): string {
  const p = item.normalized_payload;
  switch (item.resource_type) {
    case "Observation":
      if (p.vital_type === "blood_pressure") return `BP ${p.systolic}/${p.diastolic}`;
      return `${p.vital_type}: ${p[
        p.vital_type === "glucose"
          ? "glucose_mmol_l"
          : p.vital_type === "weight"
            ? "weight_kg"
            : p.vital_type === "temperature"
              ? "temperature_c"
              : p.vital_type === "spo2"
                ? "spo2_pct"
                : p.vital_type === "waist_circumference"
                  ? "waist_cm"
                  : "pulse_bpm"
      ]}`;
    case "AllergyIntolerance":
      return `${p.allergen} (${p.severity}) — ${p.reaction}`;
    case "MedicationStatement":
    case "MedicationRequest":
      return `${p.drug_name}${p.dose ? ` — ${p.dose}` : ""}`;
    case "Immunization":
      return `Dose ${p.dose_number ?? 1}, ${p.date_administered}`;
    default:
      return "";
  }
}

function ProposedResourceRow({ item }: { item: ProposedFhirResource }) {
  const fieldId = useId();
  const [showDismiss, setShowDismiss] = useState(false);
  const [confirmState, confirmAction, confirmPending] = useActionState<FhirReviewDecisionState, FormData>(
    confirmFhirProposedResource,
    undefined
  );
  const [dismissState, dismissAction, dismissPending] = useActionState<FhirReviewDecisionState, FormData>(
    dismissFhirProposedResource,
    undefined
  );

  const resolved = confirmState?.message || dismissState?.message;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {item.patient?.full_name ?? "Patient"}
          {item.patient?.patient_number ? ` · ${item.patient.patient_number}` : ""}
        </p>
        <Badge variant="blue">{RESOURCE_TYPE_LABEL[item.resource_type]}</Badge>
        {item.batch?.source_system && <Badge variant="grey">{item.batch.source_system}</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink/80">{payloadSummary(item)}</p>
      {item.parse_warnings && item.parse_warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-700">
          {item.parse_warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-charcoal-ink/60">Received {formatDate(item.proposed_at)}</p>

      {resolved ? (
        <p className="text-sm text-charcoal-ink/70">{resolved}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={confirmAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" size="sm" disabled={confirmPending}>
              {confirmPending ? "Confirming…" : "Confirm"}
            </Button>
          </form>
          {!showDismiss ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowDismiss(true)}>
              Dismiss
            </Button>
          ) : (
            <form action={dismissAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={item.id} />
              <Input
                id={fieldId}
                name="dismissal_reason"
                placeholder="Reason for dismissing"
                className="h-8 w-56 text-xs"
                required
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={dismissPending}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                {dismissPending ? "Dismissing…" : "Confirm dismiss"}
              </Button>
            </form>
          )}
        </div>
      )}
      {(confirmState?.error || dismissState?.error) && (
        <p className="text-xs text-red-600">{confirmState?.error ?? dismissState?.error}</p>
      )}
    </li>
  );
}

export function FhirReviewQueue({ proposed }: { proposed: ProposedFhirResource[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting for review ({proposed.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {proposed.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting — every imported resource has been reviewed.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {proposed.map((item) => (
              <ProposedResourceRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
