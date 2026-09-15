"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createPayerPlanAction, setPayerPlanStatusAction } from "./actions";

type Plan = {
  id: string;
  code: string;
  name: string;
  plan_year: number | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
};

const STATUS_BADGE: Record<string, "grey" | "green" | "blue"> = {
  draft: "grey",
  active: "green",
  closed: "blue",
};

export function PlansManager({ insurerId, plans }: { insurerId: string; plans: Plan[] }) {
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
          <CardTitle>New plan</CardTitle>
          <CardDescription>27.2: a named product this insurer can attach benefits and policies to.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("insurerId", insurerId);
              run((f) => createPayerPlanAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" required maxLength={40} placeholder="RELIANCE-GOLD" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} placeholder="Gold Plan" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planYear">Plan year</Label>
              <Input id="planYear" name="planYear" type="number" min={2020} max={2100} />
            </div>
            <Button type="submit" disabled={pending}>
              Create plan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No plans yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Year</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-t border-charcoal-ink/10">
                      <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
                      <td className="py-2 pr-4">{p.name}</td>
                      <td className="py-2 pr-4">{p.plan_year ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_BADGE[p.status] ?? "grey"}>{p.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            run((f) => setPayerPlanStatusAction(undefined, f), new FormData(e.currentTarget));
                          }}
                        >
                          <input type="hidden" name="planId" value={p.id} />
                          <Select name="status" defaultValue={p.status} className="h-8 w-28 text-xs">
                            <option value="draft">draft</option>
                            <option value="active">active</option>
                            <option value="closed">closed</option>
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
