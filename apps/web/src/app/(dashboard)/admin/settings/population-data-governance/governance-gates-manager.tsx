"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { attestGateAction, type AttestGateState } from "./actions";

export type GateRow = {
  gate_key: "sufficient_real_patient_volume" | "ndpc_registration_and_dpo" | "anonymisation_methodology_reviewed";
  met: boolean;
  evidence: string | null;
  attested_by: string | null;
  attested_at: string | null;
};

const GATE_LABEL: Record<GateRow["gate_key"], string> = {
  sufficient_real_patient_volume: "Sufficient real patient volume",
  ndpc_registration_and_dpo: "NDPC registration + DPO appointed",
  anonymisation_methodology_reviewed: "Anonymisation methodology reviewed",
};

const GATE_HELP: Record<GateRow["gate_key"], string> = {
  sufficient_real_patient_volume:
    "Enough real (non-test) patients that an aggregate cut is statistically meaningful and safely non-re-identifiable in Nigeria's actual population-density patterns — not a specific headcount target, a judgement call at the time.",
  ndpc_registration_and_dpo:
    "NDPC registration and a Data Protection Officer appointment actually completed — a heavier NDPR exposure than the core platform.",
  anonymisation_methodology_reviewed:
    "A defensible, specified anonymisation methodology (k-anonymity / minimum-cohort thresholds) reviewed before build — not \"add a GROUP BY.\"",
};

function GateForm({ gate }: { gate: GateRow }) {
  const [state, action, pending] = useActionState<AttestGateState, FormData>(
    attestGateAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {GATE_LABEL[gate.gate_key]}
          <Badge variant={gate.met ? "green" : "grey"}>{gate.met ? "Met" : "Not met"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">{GATE_HELP[gate.gate_key]}</p>
        {gate.attested_at && (
          <p className="text-xs text-charcoal-ink/50">
            Last attested {new Date(gate.attested_at).toLocaleString("en-GB")}
            {gate.evidence ? ` — ${gate.evidence}` : ""}
          </p>
        )}
        <form action={action} className="space-y-2">
          <input type="hidden" name="gate_key" value={gate.gate_key} />
          <div className="space-y-1">
            <label htmlFor={`evidence-${gate.gate_key}`} className="text-sm font-medium text-charcoal-ink">
              Evidence (e.g. NDPC registration number, DPO name and appointment date)
            </label>
            <textarea
              id={`evidence-${gate.gate_key}`}
              name="evidence"
              rows={2}
              defaultValue={gate.evidence ?? ""}
              className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" name="met" value="true" size="sm" disabled={pending || gate.met}>
              {pending ? "Saving…" : "Mark met"}
            </Button>
            <Button
              type="submit"
              name="met"
              value="false"
              size="sm"
              variant="outline"
              disabled={pending || !gate.met}
            >
              {pending ? "Saving…" : "Mark not met"}
            </Button>
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

export function GovernanceGatesManager({
  gates,
  allGatesMet,
}: {
  gates: GateRow[];
  allGatesMet: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center gap-2">
            <Badge variant={allGatesMet ? "green" : "amber"}>
              {allGatesMet ? "All 3 gates met" : "Dataset preview blocked"}
            </Badge>
          </div>
          <p className="text-sm text-charcoal-ink/70">
            {allGatesMet
              ? "analytics_population_dataset_preview() now returns real, aggregated data instead of a blocked response. This is still an internal preview only — nothing here transmits, exports, or hands data to any external party. Making it external-facing is a separate, deliberate build."
              : "analytics_population_dataset_preview() returns {blocked: true} until every gate below is marked met. Attesting a gate here is a real compliance record — only do this once the underlying fact is actually true (registration completed, methodology actually reviewed, volume actually sufficient), not to unblock the preview for its own sake."}
          </p>
        </CardContent>
      </Card>

      {gates.map((gate) => (
        <GateForm key={gate.gate_key} gate={gate} />
      ))}
    </div>
  );
}
