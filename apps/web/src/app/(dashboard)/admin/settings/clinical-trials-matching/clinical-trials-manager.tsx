"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createClinicalTrialAction,
  attestEthicsApprovalAction,
  runMatchingPreviewAction,
  type CreateTrialState,
  type AttestEthicsState,
  type MatchingPreviewState,
} from "./actions";

const EXAMPLE_ELIGIBILITY = JSON.stringify(
  { op: "in", field: "hypertension_tier", value: ["moderate", "high"] },
  null,
  2
);

export type TrialRow = {
  id: string;
  name: string;
  sponsor: string | null;
  protocol_reference: string | null;
  status: string;
  ethics_committee_name: string | null;
  ethics_reference: string | null;
  ethics_approved_at: string | null;
  created_at: string;
};

function NewTrialForm() {
  const [state, action, pending] = useActionState<CreateTrialState, FormData>(
    createClinicalTrialAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New trial</CardTitle>
        <CardDescription>
          Created with eligibility_rule = <code>{"{\"op\":\"false\"}"}</code> (matches nobody) if left
          blank — a draft can never accidentally match real patients before its criteria are written.
          The matching preview stays blocked regardless of criteria until ethics approval is attested
          below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Trial name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sponsor">Sponsor (optional)</Label>
              <Input id="sponsor" name="sponsor" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="protocol_reference">Protocol reference (optional)</Label>
              <Input id="protocol_reference" name="protocol_reference" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="eligibility_rule_json">Eligibility rule (JSON, optional)</Label>
            <Textarea
              id="eligibility_rule_json"
              name="eligibility_rule_json"
              placeholder={EXAMPLE_ELIGIBILITY}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Create trial"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Created.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function EthicsAttestationForm({ trial }: { trial: TrialRow }) {
  const [state, action, pending] = useActionState<AttestEthicsState, FormData>(
    attestEthicsApprovalAction,
    undefined
  );
  const approved = trial.ethics_approved_at !== null;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="trial_id" value={trial.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`committee-${trial.id}`}>Ethics committee name</Label>
          <Input
            id={`committee-${trial.id}`}
            name="ethics_committee_name"
            defaultValue={trial.ethics_committee_name ?? ""}
            placeholder="NHREC or the study's IRB"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ref-${trial.id}`}>Ethics approval reference</Label>
          <Input
            id={`ref-${trial.id}`}
            name="ethics_reference"
            defaultValue={trial.ethics_reference ?? ""}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="approved" value="true" size="sm" disabled={pending || approved}>
          {pending ? "Saving…" : "Attest ethics approval"}
        </Button>
        <Button
          type="submit"
          name="approved"
          value="false"
          size="sm"
          variant="outline"
          disabled={pending || !approved}
        >
          {pending ? "Saving…" : "Clear approval"}
        </Button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
    </form>
  );
}

function MatchingPreviewButton({ trialId }: { trialId: string }) {
  const [state, action, pending] = useActionState<MatchingPreviewState, FormData>(
    runMatchingPreviewAction,
    undefined
  );
  const result = state?.result;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="trial_id" value={trialId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Running…" : "Run matching preview"}
      </Button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {result && (
        <div className="rounded-md border border-mist-grey/40 p-3 text-sm">
          {result.blocked ? (
            <p className="text-charcoal-ink/70">
              <Badge variant="amber" className="mr-2">
                Blocked
              </Badge>
              {String(result.reason ?? "")}
            </p>
          ) : (
            <p className="text-charcoal-ink">
              <Badge variant="green" className="mr-2">
                Matched
              </Badge>
              {String(result.matched_patient_count ?? 0)} patient
              {result.matched_patient_count === 1 ? "" : "s"} — count only, no identities returned.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

export function ClinicalTrialsManager({ trials }: { trials: TrialRow[] }) {
  return (
    <div className="space-y-6">
      <NewTrialForm />

      {trials.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-charcoal-ink/60">
              No trials yet — the capability is fully inert until one exists.
            </p>
          </CardContent>
        </Card>
      ) : (
        trials.map((trial) => (
          <Card key={trial.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {trial.name}
                <Badge variant={trial.ethics_approved_at ? "green" : "grey"}>
                  {trial.ethics_approved_at ? "Ethics approved" : "No ethics approval on file"}
                </Badge>
              </CardTitle>
              {trial.sponsor && (
                <p className="text-sm text-charcoal-ink/60">Sponsor: {trial.sponsor}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <EthicsAttestationForm trial={trial} />
              <MatchingPreviewButton trialId={trial.id} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
