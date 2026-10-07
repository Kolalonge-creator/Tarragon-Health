"use client";

import { useActionState, useId, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  confirmFhirProposedResource,
  dismissFhirProposedResource,
  modifyFhirProposedResource,
  type FhirReviewDecisionState,
} from "./actions";
import { VITAL_TYPE_VALUE_FIELD } from "@/lib/integrations/fhir/vital-mapping";
import { fieldKindOf } from "@/lib/integrations/fhir/editable-field-config";

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

const FIELD_LABEL: Record<string, string> = {
  taken_at: "Taken at",
  systolic: "Systolic",
  diastolic: "Diastolic",
  glucose_mmol_l: "Glucose (mmol/L)",
  glucose_context: "Glucose context",
  weight_kg: "Weight (kg)",
  temperature_c: "Temperature (°C)",
  spo2_pct: "SpO2 (%)",
  waist_cm: "Waist (cm)",
  pulse_bpm: "Pulse (bpm)",
  allergen: "Allergen",
  reaction: "Reaction",
  severity: "Severity",
  noted_at: "Noted at",
  drug_name: "Drug name",
  dose: "Dose",
  frequency: "Frequency",
  is_active: "Active",
  dose_number: "Dose number",
  date_administered: "Date administered",
  provider: "Provider",
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
    case "Observation": {
      if (p.vital_type === "blood_pressure") return `BP ${p.systolic}/${p.diastolic}`;
      const field = VITAL_TYPE_VALUE_FIELD[p.vital_type as keyof typeof VITAL_TYPE_VALUE_FIELD];
      return field ? `${p.vital_type}: ${p[field]}` : `${p.vital_type} (unrecognised)`;
    }
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

/** Renders the one input control that matches `fieldKindOf(key)` — the same
 * config `modifyFhirProposedResource` coerces the submission against, so
 * the browser can never submit a value the server would reject as the
 * wrong shape (an enum field is a real `<select>`, a boolean is a real
 * checkbox, a number gets `type="number"`, a date/datetime gets the
 * matching native picker). */
function EditableField({ itemId, fieldKey, value }: { itemId: string; fieldKey: string; value: unknown }) {
  const kind = fieldKindOf(fieldKey);
  const inputId = `${itemId}-${fieldKey}`;
  const label = FIELD_LABEL[fieldKey] ?? fieldKey;

  if (kind === "readonly") return null;

  if (kind === "boolean") {
    return (
      <div key={fieldKey} className="flex items-center gap-2">
        <input
          type="checkbox"
          id={inputId}
          name={`edited.${fieldKey}`}
          defaultChecked={value === true}
          className="h-4 w-4"
        />
        <Label htmlFor={inputId} className="text-xs">
          {label}
        </Label>
      </div>
    );
  }

  const stringValue = value === null || value === undefined ? "" : String(value);

  if (typeof kind === "object" && "select" in kind) {
    return (
      <div key={fieldKey} className="space-y-1">
        <Label htmlFor={inputId} className="text-xs">
          {label}
        </Label>
        <Select id={inputId} name={`edited.${fieldKey}`} defaultValue={stringValue} className="h-8 text-xs">
          {kind.select.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  return (
    <div key={fieldKey} className="space-y-1">
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <Input
        id={inputId}
        name={`edited.${fieldKey}`}
        type={kind === "number" ? "number" : kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : "text"}
        step={kind === "number" ? "any" : undefined}
        defaultValue={kind === "datetime" && stringValue ? stringValue.slice(0, 16) : stringValue}
        className="h-8 text-xs"
      />
    </div>
  );
}

function EditAndConfirmForm({ item, onCancel }: { item: ProposedFhirResource; onCancel: () => void }) {
  const [modifyState, modifyAction, modifyPending] = useActionState<FhirReviewDecisionState, FormData>(
    modifyFhirProposedResource,
    undefined
  );
  const entries = Object.entries(item.normalized_payload);

  return (
    <form action={modifyAction} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="id" value={item.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <EditableField key={key} itemId={item.id} fieldKey={key} value={value} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={modifyPending}>
          {modifyPending ? "Confirming…" : "Confirm with edits"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {modifyState?.error && <p className="text-xs text-red-600">{modifyState.error}</p>}
    </form>
  );
}

function ProposedResourceRow({ item }: { item: ProposedFhirResource }) {
  const fieldId = useId();
  const [showDismiss, setShowDismiss] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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
      ) : showEdit ? (
        <EditAndConfirmForm item={item} onCancel={() => setShowEdit(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={confirmAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" size="sm" disabled={confirmPending}>
              {confirmPending ? "Confirming…" : "Confirm"}
            </Button>
          </form>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            Edit & confirm
          </Button>
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
