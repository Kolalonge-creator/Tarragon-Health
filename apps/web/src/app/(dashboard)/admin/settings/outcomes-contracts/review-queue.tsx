"use client";

import { useState } from "react";
import {
  usePendingOutcomesContractRequests,
  useApproveOutcomesContractRequest,
  useRejectOutcomesContractRequest,
  type OutcomesContractChangeRequest,
} from "@/lib/queries/outcomes-contract-requests";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CONTRACT_TYPE_LABEL: Record<OutcomesContractChangeRequest["contract_type"], string> = {
  fee_at_risk: "Fee-at-risk (outcomes-based)",
  flat: "Flat fee",
};

function ThresholdList({ thresholds }: { thresholds: unknown }) {
  const list = Array.isArray(thresholds)
    ? (thresholds as { metric?: string; label?: string; target?: number }[])
    : [];
  if (list.length === 0) return <p className="text-xs text-charcoal-ink/50">No metric targets proposed.</p>;
  return (
    <ul className="text-xs text-charcoal-ink/70">
      {list.map((t, i) => (
        <li key={t.metric ?? i}>
          {t.label ?? t.metric}: {t.target}%
        </li>
      ))}
    </ul>
  );
}

/** Superadmin-only fee-at-risk contract review queue — see
 * propose_outcomes_contract_change() / approve_outcomes_contract_request() /
 * reject_outcomes_contract_request() (20260901180020_outcomes_contracts_self_service.sql).
 * An HMO/corporate admin proposes terms from their own dashboard
 * (ProposeContractCard); this is the only place that can turn a proposal
 * into a real outcomes_contracts row. */
export function OutcomesContractReviewQueue() {
  const { data: requests, isLoading, isError } = usePendingOutcomesContractRequests();
  const approve = useApproveOutcomesContractRequest();
  const reject = useRejectOutcomesContractRequest();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Could not load pending contract requests.</p>;

  const mutationError =
    (approve.error as Error | null)?.message ?? (reject.error as Error | null)?.message ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending fee-at-risk contract requests</CardTitle>
        <CardDescription>
          Approving here creates the real outcomes_contracts row; nothing an org proposes takes
          effect until you do.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mutationError && <p className="text-sm text-red-600">{mutationError}</p>}
        {!requests || requests.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing pending.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {requests.map((r) => (
              <li key={r.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {r.organisation?.name ?? "Unknown org"}
                  </p>
                  <Badge variant="blue">{CONTRACT_TYPE_LABEL[r.contract_type]}</Badge>
                </div>
                <p className="text-xs text-charcoal-ink/50">
                  Proposed by {r.requested_by_profile?.full_name ?? "unknown"} · effective{" "}
                  {new Date(r.proposed_effective_from).toLocaleDateString()}
                </p>
                <ThresholdList thresholds={r.proposed_outcome_thresholds} />
                {r.proposed_payout_terms && (
                  <p className="text-sm text-charcoal-ink/70">{r.proposed_payout_terms}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: r.id })}
                  >
                    Approve
                  </Button>
                  <Input
                    placeholder="Rejection reason"
                    className="h-8 w-48"
                    value={rejectReasons[r.id] ?? ""}
                    onChange={(e) => setRejectReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reject.isPending || !rejectReasons[r.id]?.trim()}
                    onClick={() => reject.mutate({ id: r.id, reason: rejectReasons[r.id].trim() })}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
