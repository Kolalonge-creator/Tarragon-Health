"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createSettlementAction, setSettlementStatusAction } from "./actions";

type Settlement = {
  id: string;
  reference: string | null;
  period_start: string;
  period_end: string;
  invoiced_total_kobo: number;
  status: string;
};

const STATUS_BADGE: Record<string, "grey" | "amber" | "red" | "blue" | "green"> = {
  draft: "grey",
  issued: "amber",
  disputed: "red",
  approved: "blue",
  settled: "green",
};

export function SettlementsManager({ organisationId, settlements }: { organisationId: string; settlements: Settlement[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: (fd: FormData) => Promise<{ error?: string; message?: string } | undefined>, fd: FormData) {
    startTransition(async () => {
      const result = await action(fd);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New statement</CardTitle>
          <CardDescription>28.10: one billing period.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-5 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("organisationId", organisationId);
              run((f) => createSettlementAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="periodStart">Period start</Label>
              <Input id="periodStart" name="periodStart" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodEnd">Period end</Label>
              <Input id="periodEnd" name="periodEnd" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoicedTotalKobo">Invoiced (kobo)</Label>
              <Input id="invoicedTotalKobo" name="invoicedTotalKobo" type="number" min={0} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference</Label>
              <Input id="reference" name="reference" maxLength={100} />
            </div>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Statements</CardTitle>
        </CardHeader>
        <CardContent>
          {settlements.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No statements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Invoiced</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-t border-charcoal-ink/10">
                      <td className="py-2 pr-4">
                        {s.period_start} → {s.period_end}
                      </td>
                      <td className="py-2 pr-4">{s.reference ?? "—"}</td>
                      <td className="py-2 pr-4">₦{(s.invoiced_total_kobo / 100).toLocaleString()}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_BADGE[s.status] ?? "grey"}>{s.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            run((f) => setSettlementStatusAction(undefined, f), new FormData(e.currentTarget));
                          }}
                        >
                          <input type="hidden" name="settlementId" value={s.id} />
                          <Select name="status" defaultValue={s.status} className="h-8 w-28 text-xs">
                            <option value="draft">draft</option>
                            <option value="issued">issued</option>
                            <option value="disputed">disputed</option>
                            <option value="approved">approved</option>
                            <option value="settled">settled</option>
                          </Select>
                          <Button type="submit" size="sm" variant="outline" disabled={pending}>
                            Save
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
