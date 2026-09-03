"use client";

import { useState } from "react";
import Link from "next/link";
import { useActiveCases, useCaseCandidates, useOpenCase, type CaseRow } from "@/lib/queries/care-management";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const ENTRY_REASON_LABEL: Record<CaseRow["entry_reason"], string> = {
  risk_engine: "Risk engine",
  clinician_referral: "Clinician referral",
  hospital_discharge: "Hospital discharge",
  repeated_alerts: "Repeated alerts",
  care_coordinator_escalation: "Care coordinator escalation",
};

export function CaseWorklist({ organisationId }: { organisationId: string }) {
  const { data: cases, isLoading, isError } = useActiveCases();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Active cases</CardTitle>
          <CardDescription>Most recently opened first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load active cases.</p>}
          {cases && cases.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No active cases right now.</p>
          )}
          {cases && cases.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {cases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-charcoal-ink">
                        {c.patient?.full_name ?? "Unknown patient"}
                      </span>
                      <Badge variant="blue">{ENTRY_REASON_LABEL[c.entry_reason]}</Badge>
                    </div>
                    <p className="text-xs text-charcoal-ink/50">
                      Opened {new Date(c.opened_at).toLocaleDateString()}
                      {c.case_manager ? ` · Case manager: ${c.case_manager.full_name}` : " · No case manager assigned"}
                    </p>
                  </div>
                  <Link href={`/clinician/case-management/${c.id}`}>
                    <Button type="button" variant="outline" size="sm">
                      Open
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CaseCandidates organisationId={organisationId} />
    </div>
  );
}

function CaseCandidates({ organisationId }: { organisationId: string }) {
  const { data: candidates, isLoading } = useCaseCandidates();
  const openCase = useOpenCase();
  const [openingId, setOpeningId] = useState<string | null>(null);

  if (isLoading || !candidates || candidates.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>High-risk candidates</CardTitle>
        <CardDescription>
          Flagged high or very-high risk by the risk engine and not yet in an active case (74.7).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {candidates.map((patient) => (
            <li key={patient.id} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-charcoal-ink">{patient.full_name ?? "Unknown patient"}</span>
              <Button
                type="button"
                size="sm"
                disabled={openCase.isPending && openingId === patient.id}
                onClick={() => {
                  setOpeningId(patient.id);
                  openCase.mutate({
                    organisationId,
                    patientId: patient.id,
                    entryReason: "risk_engine",
                    entryDetail: "Flagged high-risk by the risk engine (high_risk_patient_ids).",
                  });
                }}
              >
                Open case
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
