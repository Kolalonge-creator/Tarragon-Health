"use client";

import { useActionState } from "react";
import { confirmFhirImportResourceAction, dismissFhirImportResourceAction, type FhirImportActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PendingFhirImport {
  id: string;
  patientName: string;
  resourceType: string;
  normalizedPayload: Record<string, unknown>;
  parseWarnings: string[];
  sourceSystem: string | null;
  receivedAt: string;
}

function previewText(resourceType: string, payload: Record<string, unknown>): string {
  switch (resourceType) {
    case "Observation": {
      const vitalType = String(payload.vital_type ?? "reading");
      if (vitalType === "blood_pressure") return `Blood pressure ${payload.systolic ?? "?"}/${payload.diastolic ?? "?"} mmHg`;
      const value = Object.entries(payload).find(([key]) => key.endsWith("_mmol_l") || key.endsWith("_kg") || key.endsWith("_c") || key.endsWith("_pct") || key.endsWith("_cm") || key === "pulse_bpm");
      return `${vitalType.replace(/_/g, " ")}: ${value ? value[1] : "no value"}`;
    }
    case "AllergyIntolerance":
      return `Allergen: ${payload.allergen ?? "unknown"}${payload.severity ? ` (${payload.severity})` : ""}`;
    case "MedicationStatement":
    case "MedicationRequest":
      return `${payload.drug_name ?? "Medication"}${payload.dose ? `, ${payload.dose}` : ""}${payload.is_active === false ? " (stopped)" : ""}`;
    case "Immunization":
      return payload.vaccination_catalog_id
        ? `Vaccine administered ${String(payload.date_administered ?? "")}`
        : "Vaccine administered (catalogue match not found, cannot be confirmed as-is)";
    default:
      return JSON.stringify(payload);
  }
}

export function FhirImportsClient({ items }: { items: PendingFhirImport[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          Nothing waiting. Every imported resource has been reviewed.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ImportRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function ImportRow({ item }: { item: PendingFhirImport }) {
  const [confirmState, submitConfirm] = useActionState<FhirImportActionState, FormData>(confirmFhirImportResourceAction, undefined);
  const [dismissState, submitDismiss] = useActionState<FhirImportActionState, FormData>(dismissFhirImportResourceAction, undefined);

  const blockedByUnmatchedVaccine = item.resourceType === "Immunization" && !item.normalizedPayload.vaccination_catalog_id;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{item.patientName}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="grey">{item.resourceType}</Badge>
          {item.sourceSystem && <Badge variant="blue">{item.sourceSystem}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{previewText(item.resourceType, item.normalizedPayload)}</p>
        {item.parseWarnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700">
            {item.parseWarnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          Received {new Date(item.receivedAt).toLocaleString()}
        </p>

        <div className="flex flex-wrap items-start gap-4 pt-1">
          <form action={submitConfirm}>
            <input type="hidden" name="resourceId" value={item.id} />
            <Button type="submit" size="sm" disabled={blockedByUnmatchedVaccine}>
              Confirm
            </Button>
          </form>

          <form action={submitDismiss} className="flex flex-1 min-w-[240px] items-end gap-2">
            <input type="hidden" name="resourceId" value={item.id} />
            <div className="flex-1">
              <Textarea name="reason" placeholder="Reason for dismissing (required)" rows={1} className="text-sm" />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Dismiss
            </Button>
          </form>
        </div>

        {blockedByUnmatchedVaccine && (
          <p className="text-xs text-destructive">
            No matching vaccine in the catalogue was found automatically. Dismiss this one and ask the partner to
            resend it with a clearer vaccine code, or add it manually once reviewed.
          </p>
        )}
        {confirmState?.error && <p className="text-sm text-destructive">{confirmState.error}</p>}
        {dismissState?.error && <p className="text-sm text-destructive">{dismissState.error}</p>}
      </CardContent>
    </Card>
  );
}
