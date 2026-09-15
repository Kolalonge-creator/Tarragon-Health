"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { generateBoardReportAction } from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Yesterday, in Africa/Lagos — the latest period end the database will accept,
 * since a period that has not closed cannot be reported on. */
function latestPermittedEnd(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function defaultQuarterStart(): string {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - 3);
  now.setUTCDate(1);
  return now.toISOString().slice(0, 10);
}

export function GenerateReportForm({ insurerId }: { insurerId: string }) {
  const [state, formAction, pending] = useActionState(generateBoardReportAction, undefined);
  const router = useRouter();

  // Navigating during render is a React anti-pattern (and warns in dev); the
  // new report is opened once, after the action settles.
  useEffect(() => {
    if (state?.reportId) router.push(`/payer/board-report/${state.reportId}`);
  }, [state?.reportId, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate a report</CardTitle>
        <CardDescription>
          Choose a period that has already ended. The measures in force today are applied to that
          period, and the version of each definition used is recorded on the report itself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="insurerId" value={insurerId} />
          <div className="space-y-1.5">
            <Label htmlFor="periodStart">Period start</Label>
            <Input
              id="periodStart"
              name="periodStart"
              type="date"
              defaultValue={defaultQuarterStart()}
              max={latestPermittedEnd()}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="periodEnd">Period end</Label>
            <Input
              id="periodEnd"
              name="periodEnd"
              type="date"
              defaultValue={latestPermittedEnd()}
              max={latestPermittedEnd()}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate"}
          </Button>
        </form>
        {state?.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
        {state?.message && <p className="mt-3 text-sm text-brand-green">{state.message}</p>}
      </CardContent>
    </Card>
  );
}
