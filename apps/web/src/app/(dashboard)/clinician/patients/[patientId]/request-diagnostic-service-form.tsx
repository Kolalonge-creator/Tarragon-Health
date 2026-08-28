"use client";

import { useState } from "react";
import { useDiagnosticServiceCatalogue, useCreateDiagnosticRequest } from "@/lib/queries/diagnostic-requests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@tarragon/shared";

type Urgency = Database["public"]["Enums"]["diagnostic_urgency"];

const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "emergency", label: "Emergency" },
];

/**
 * Clinician-generated diagnostic request (15.2 — "ECG required." or
 * "Echocardiogram requested."). This is the ONLY way a diagnostic request
 * gets created: there is no patient self-order path anywhere in this
 * module, per the Master Operating Plan's "never patient-orderable, at any
 * tier or phase" guardrail (CT, MRI, echocardiography and others). The
 * clinician records why (indication), what they need answered (clinical
 * question), how urgent it is, and any other relevant information — the
 * patient then books a facility/date/time on this request from their own
 * dashboard (15.3).
 */
export function RequestDiagnosticServiceForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: catalogue, isLoading } = useDiagnosticServiceCatalogue();
  const createRequest = useCreateDiagnosticRequest(patientId);
  const [catalogueId, setCatalogueId] = useState("");
  const [indication, setIndication] = useState("");
  const [clinicalQuestion, setClinicalQuestion] = useState("");
  const [relevantInformation, setRelevantInformation] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("routine");

  const service = catalogue?.find((c) => c.id === catalogueId) ?? null;

  function reset() {
    setCatalogueId("");
    setIndication("");
    setClinicalQuestion("");
    setRelevantInformation("");
    setUrgency("routine");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a diagnostic service</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading catalogue…</p>}
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic-service">Service</Label>
          <Select
            id="diagnostic-service"
            value={catalogueId}
            onChange={(e) => setCatalogueId(e.target.value)}
          >
            <option value="">Select a service</option>
            {(catalogue ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {service?.prep_instructions && (
          <p className="text-xs text-charcoal-ink/60">Preparation: {service.prep_instructions}</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic-indication">Indication</Label>
          <Textarea
            id="diagnostic-indication"
            placeholder="Why is this needed? e.g. abnormal ECG on routine review"
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
            maxLength={1000}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic-question">Clinical question (optional)</Label>
          <Textarea
            id="diagnostic-question"
            placeholder="What do you need this to answer? e.g. assess LV function"
            value={clinicalQuestion}
            onChange={(e) => setClinicalQuestion(e.target.value)}
            maxLength={1000}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic-relevant-info">Relevant information (optional)</Label>
          <Textarea
            id="diagnostic-relevant-info"
            placeholder="Anything the reporting clinician should know — current medications, renal function, prior imaging"
            value={relevantInformation}
            onChange={(e) => setRelevantInformation(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic-urgency">Urgency</Label>
          <Select id="diagnostic-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
            {URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {createRequest.isError && (
          <p className="text-sm text-red-600">
            {(createRequest.error as Error).message || "Could not create the request. Try again."}
          </p>
        )}
        {createRequest.isSuccess && (
          <p className="text-sm text-brand-green">
            Request created. The patient can now book a facility, date, and time from their
            dashboard.
          </p>
        )}
        <Button
          disabled={!service || !indication.trim() || createRequest.isPending}
          onClick={() =>
            service &&
            createRequest.mutate(
              {
                organisationId,
                modality: service.modality,
                serviceName: service.name,
                indication: indication.trim(),
                clinicalQuestion: clinicalQuestion.trim() || undefined,
                relevantInformation: relevantInformation.trim() || undefined,
                urgency,
                catalogueId: service.id,
              },
              { onSuccess: reset },
            )
          }
        >
          {createRequest.isPending ? "Requesting…" : "Request service"}
        </Button>
      </CardContent>
    </Card>
  );
}
