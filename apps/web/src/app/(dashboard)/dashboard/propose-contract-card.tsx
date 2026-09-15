"use client";

import { useActionState } from "react";
import { proposeContractChange } from "@/lib/outcomes-contracts/propose-contract-change";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared between /dashboard/hmo and /dashboard/corporate — lets an org's own
 * hmo_admin/corporate_admin propose fee-at-risk terms. This never writes
 * outcomes_contracts directly: it submits an
 * outcomes_contract_change_requests row via propose_outcomes_contract_change(),
 * which only a superadmin can approve (see 20260901180020_outcomes_contracts_self_service.sql).
 */
export function ProposeContractCard({ organisationId }: { organisationId: string }) {
  const [state, formAction, pending] = useActionState(
    proposeContractChange.bind(null, organisationId),
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Propose contract terms</CardTitle>
        <CardDescription>
          Sent to Tarragon for review. A superadmin approves or rejects it before it takes effect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.message && <p className="text-sm text-charcoal-ink/70">{state.message}</p>}

          <div className="space-y-1">
            <Label htmlFor="contractType">Contract type</Label>
            <select
              id="contractType"
              name="contractType"
              defaultValue="fee_at_risk"
              className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 text-sm"
            >
              <option value="fee_at_risk">Fee-at-risk (outcomes-based)</option>
              <option value="flat">Flat fee</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="target_screening_compliance_percent">
                Screening compliance target (%)
              </Label>
              <Input
                id="target_screening_compliance_percent"
                name="target_screening_compliance_percent"
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 70"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="target_bp_control_percent">Average BP control target (%)</Label>
              <Input
                id="target_bp_control_percent"
                name="target_bp_control_percent"
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 60"
              />
            </div>
          </div>
          <p className="text-xs text-charcoal-ink/50">
            Leave a target blank to skip that metric. These are the only two Tarragon currently
            tracks automatically.
          </p>

          <div className="space-y-1">
            <Label htmlFor="payoutTerms">Payout terms</Label>
            <Textarea
              id="payoutTerms"
              name="payoutTerms"
              rows={3}
              placeholder="Describe the fee-at-risk arrangement in plain terms"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="effectiveFrom">Proposed effective date</Label>
            <Input id="effectiveFrom" name="effectiveFrom" type="date" />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send for review"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
