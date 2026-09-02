"use client";

import { useState } from "react";
import {
  useOrgPrescriptionRenewalRequests,
  useMarkRenewalInReview,
  useDecideRenewalRequest,
  type PrescriptionRenewalRequestWithPatient,
} from "@/lib/queries/prescription-renewal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function RequestRow({ request }: { request: PrescriptionRenewalRequestWithPatient }) {
  const markInReview = useMarkRenewalInReview();
  const decide = useDecideRenewalRequest();
  const [note, setNote] = useState("");
  const overdue = request.sla_due_at && new Date(request.sla_due_at) < new Date();

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        {request.status === "in_review" && <Badge variant="amber">In review</Badge>}
        {overdue && <Badge variant="red">SLA passed</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink">
        {request.medication?.drug_name ?? "Medication"}
        {request.medication?.dose ? `, ${request.medication.dose}` : ""}
      </p>
      {request.patient_note && (
        <p className="text-xs text-charcoal-ink/60">Patient note: {request.patient_note}</p>
      )}
      {request.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          Respond by {new Date(request.sla_due_at).toLocaleString()}
        </p>
      )}
      {request.status === "submitted" && (
        <Button
          size="sm"
          variant="outline"
          disabled={markInReview.isPending}
          onClick={() => markInReview.mutate(request.id)}
        >
          Start review
        </Button>
      )}
      <div className="space-y-2">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Note for the patient (optional for approval, recommended if declining)."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ requestId: request.id, decision: "approved", doctorNote: note })}
          >
            {decide.isPending ? "Sending…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ requestId: request.id, decision: "declined", doctorNote: note })}
          >
            Decline
          </Button>
        </div>
        {decide.isError && (
          <p className="text-xs text-red-600">
            {(decide.error as Error).message || "Could not record this decision."}
          </p>
        )}
      </div>
    </li>
  );
}

export default function PrescriptionRenewalsPage() {
  const { data, isLoading, isError } = useOrgPrescriptionRenewalRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Prescription renewals</h1>
        <p className="text-sm text-charcoal-ink/60">
          Patient-requested renewal reviews. Approving here records your decision only — issue the
          actual renewed prescription through the patient&apos;s chart, as usual.
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
