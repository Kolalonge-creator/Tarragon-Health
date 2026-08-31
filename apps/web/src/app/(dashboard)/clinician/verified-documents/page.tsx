"use client";

import { useState } from "react";
import {
  useOrgVerifiedDocumentRequests,
  useDecideVerifiedDocument,
  type VerifiedDocumentWithPatient,
} from "@/lib/queries/verified-documents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  fit_to_work: "Fit-to-work letter",
  travel_health_certificate: "Travel health certificate",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function RequestRow({ request }: { request: VerifiedDocumentWithPatient }) {
  const decide = useDecideVerifiedDocument();
  const [attestationText, setAttestationText] = useState("");
  const [validFrom, setValidFrom] = useState(today());
  const [validUntil, setValidUntil] = useState("");
  const [declinedReason, setDeclinedReason] = useState("");
  const overdue = request.sla_due_at && new Date(request.sla_due_at) < new Date();

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        <Badge variant="blue">{DOCUMENT_TYPE_LABEL[request.document_type] ?? request.document_type}</Badge>
        {overdue && <Badge variant="red">SLA passed</Badge>}
      </div>
      {request.request_note && (
        <p className="text-xs text-charcoal-ink/60">Patient note: {request.request_note}</p>
      )}
      {request.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          Respond by {new Date(request.sla_due_at).toLocaleString()}
        </p>
      )}

      <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
        <p className="text-xs font-medium text-charcoal-ink/70">Issue this document</p>
        <Textarea
          value={attestationText}
          onChange={(e) => setAttestationText(e.target.value)}
          rows={3}
          placeholder="The exact attestation text that prints on the PDF, e.g. 'This is to certify that [patient] was reviewed on [date] and is fit to resume work.'"
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Valid from</Label>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valid until (optional)</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <Button
            size="sm"
            disabled={decide.isPending || !attestationText.trim() || !validFrom}
            onClick={() =>
              decide.mutate({
                documentId: request.id,
                decision: "issued",
                attestationText: attestationText.trim(),
                validFrom,
                validUntil: validUntil || undefined,
              })
            }
          >
            {decide.isPending ? "Issuing…" : "Issue document"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={declinedReason}
          onChange={(e) => setDeclinedReason(e.target.value)}
          placeholder="Reason for declining (shown to the patient)"
          className="h-8 flex-1 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ documentId: request.id, decision: "declined", declinedReason })}
        >
          Decline
        </Button>
      </div>
      {decide.isError && (
        <p className="text-xs text-red-600">
          {(decide.error as Error).message || "Could not record this decision."}
        </p>
      )}
    </li>
  );
}

export default function VerifiedDocumentsWorklistPage() {
  const { data, isLoading, isError } = useOrgVerifiedDocumentRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Verified documents</h1>
        <p className="text-sm text-charcoal-ink/60">
          Fit-to-work letters and travel health certificates awaiting your review. What you write
          here is exactly what prints on the patient's signed PDF.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((r) => (
                <RequestRow key={r.id} request={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
