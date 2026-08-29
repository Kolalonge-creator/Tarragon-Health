"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentPayoutBatchRow } from "@tarragon/shared";
import type { AgentWithTotals } from "@/lib/queries/agents";
import { createPayoutBatchAction, markPayoutBatchPaidAction, recruitAgentAction } from "./actions";

function kobo(n: number) {
  return `₦${(n / 100).toLocaleString()}`;
}

export function AgentsManager({
  agents,
  batches,
}: {
  agents: AgentWithTotals[];
  batches: AgentPayoutBatchRow[];
}) {
  const [recruitState, recruitFormAction, recruitPending] = useActionState(recruitAgentAction, undefined);
  const [batchState, batchFormAction, batchPending] = useActionState(createPayoutBatchAction, undefined);
  const [payState, payFormAction] = useActionState(markPayoutBatchPaidAction, undefined);

  const totalPending = agents.reduce((sum, a) => sum + a.pending_kobo, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Community agents</h1>
        <p className="text-sm text-charcoal-ink/70">
          People with standing in a community who sell care and earn a fixed commission per completed order.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recruit an agent</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={recruitFormAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone">Phone (E.164)</Label>
              <Input id="phone" name="phone" placeholder="+2348012345678" required />
              <p className="text-xs text-charcoal-ink/60">
                They must already have a Tarragon account — this looks them up, it doesn&apos;t create one.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="community_affiliation">Community (optional)</Label>
              <Input id="community_affiliation" name="community_affiliation" placeholder="e.g. Redeemer Church health unit" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={recruitPending}>
                {recruitPending ? "Recruiting…" : "Recruit as agent"}
              </Button>
              {recruitState?.error && <p className="mt-2 text-sm text-red-600">{recruitState.error}</p>}
              {recruitState?.message && <p className="mt-2 text-sm text-tarragon-green">{recruitState.message}</p>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agents ({agents.length}) · {kobo(totalPending)} pending</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-charcoal-ink/60">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Pending</th>
                <th className="py-2 pr-4">Approved</th>
                <th className="py-2 pr-4">Paid</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono">{a.agent_code}</td>
                  <td className="py-2 pr-4">
                    {a.full_name}
                    {a.community_affiliation && (
                      <span className="block text-xs text-charcoal-ink/60">{a.community_affiliation}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={a.status === "active" ? "green" : "grey"}>{a.status}</Badge>
                  </td>
                  <td className="py-2 pr-4">{kobo(a.pending_kobo)}</td>
                  <td className="py-2 pr-4">{kobo(a.approved_kobo)}</td>
                  <td className="py-2 pr-4">{kobo(a.paid_kobo)}</td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-charcoal-ink/60">
                    No agents recruited yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly payout batches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={batchFormAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="period_start">From</Label>
              <Input id="period_start" name="period_start" type="date" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="period_end">To</Label>
              <Input id="period_end" name="period_end" type="date" required />
            </div>
            <Button type="submit" disabled={batchPending}>
              {batchPending ? "Creating…" : "Create batch"}
            </Button>
          </form>
          {batchState?.error && <p className="text-sm text-red-600">{batchState.error}</p>}
          {batchState?.message && <p className="text-sm text-tarragon-green">{batchState.message}</p>}
          {payState?.error && <p className="text-sm text-red-600">{payState.error}</p>}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-charcoal-ink/60">
                <th className="py-2 pr-4">Period</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {b.period_start} → {b.period_end}
                  </td>
                  <td className="py-2 pr-4">{kobo(b.total_kobo)}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={b.status === "paid" ? "green" : "amber"}>{b.status}</Badge>
                  </td>
                  <td className="py-2 pr-4">
                    {b.status === "open" && (
                      <form action={payFormAction}>
                        <input type="hidden" name="batch_id" value={b.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Mark paid
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-charcoal-ink/60">
                    No payout batches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
