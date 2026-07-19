"use client";

import { useActionState, useState } from "react";
import { enrollAction, logReadingAction, type LifestyleActionState } from "./actions";
import type { LifestyleEnrollmentView } from "@/lib/lifestyle/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ENROLLABLE: { key: "obesity" | "htn" | "diabetes"; label: string }[] = [
  { key: "obesity", label: "Weight & lifestyle" },
  { key: "htn", label: "Blood pressure" },
  { key: "diabetes", label: "Diabetes" },
];

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paused" ? "amber" : status === "active" ? "green" : "grey";
  return <Badge variant={tone}>{status}</Badge>;
}

export function LifestyleClient({
  enrollments,
}: {
  enrollments: LifestyleEnrollmentView[];
}) {
  const [enrollState, enroll] = useActionState<LifestyleActionState, FormData>(
    enrollAction,
    undefined,
  );
  const [consented, setConsented] = useState(false);
  const enrolledConditions = new Set(enrollments.map((e) => e.conditionKey));
  const available = ENROLLABLE.filter((c) => !enrolledConditions.has(c.key));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your lifestyle programme</h1>
        <p className="text-muted-foreground text-sm">
          Small, steady changes — logged here, supported by your care team.
        </p>
      </div>

      {enrollments.map((e) => (
        <Card key={e.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">
              {e.programmeName ?? e.condition}
            </CardTitle>
            <StatusBadge status={e.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            {e.status === "paused" ? (
              <p className="text-sm text-muted-foreground">
                This programme is paused while your care team checks in with you.
                We&apos;re here to support you.
              </p>
            ) : (
              <>
                {e.currentPhaseName && (
                  <p className="text-sm">
                    Current phase:{" "}
                    <span className="font-medium">{e.currentPhaseName}</span>
                  </p>
                )}
                {e.goals.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {e.goals.map((g) => (
                      <li key={g.id} className="flex gap-2">
                        <span className="text-muted-foreground capitalize">
                          {g.module}
                        </span>
                        <span>{g.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.nextReviewDue && (
                  <p className="text-muted-foreground text-xs">
                    Next care-team review:{" "}
                    {new Date(e.nextReviewDue).toLocaleDateString()}
                  </p>
                )}
                {e.conditionKey && (
                  <LogForm enrollmentId={e.id} conditionKey={e.conditionKey} />
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {available.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Start a programme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {enrollState?.message && (
              <p className="text-sm text-brand-green">{enrollState.message}</p>
            )}
            {enrollState?.error && (
              <p className="text-sm text-destructive">{enrollState.error}</p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span className="text-muted-foreground">
                I agree that my logged readings and check-ins can be reviewed by
                my Tarragon care team to support this programme, and I can
                withdraw at any time.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {available.map((c) => (
                <form key={c.key} action={enroll}>
                  <input type="hidden" name="conditionKey" value={c.key} />
                  <input
                    type="hidden"
                    name="consent"
                    value={consented ? "on" : "off"}
                  />
                  <Button type="submit" variant="outline" disabled={!consented}>
                    {c.label}
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogForm({
  enrollmentId,
  conditionKey,
}: {
  enrollmentId: string;
  conditionKey: "obesity" | "htn" | "diabetes";
}) {
  const [state, log] = useActionState<LifestyleActionState, FormData>(
    logReadingAction,
    undefined,
  );
  return (
    <form action={log} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="conditionKey" value={conditionKey} />
      <p className="text-sm font-medium">Quick check-in</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`type-${enrollmentId}`}>What are you logging?</Label>
          <select
            id={`type-${enrollmentId}`}
            name="type"
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            defaultValue="mood"
          >
            <option value="mood">How I&apos;m feeling</option>
            <option value="weight">Weight (kg)</option>
            <option value="activity_minutes">Active minutes</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`value-${enrollmentId}`}>Value</Label>
          <Input
            id={`value-${enrollmentId}`}
            name="value"
            type="number"
            step="any"
            placeholder="e.g. 3"
          />
        </div>
      </div>

      {conditionKey === "obesity" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="strugglingWithFood" />
          I&apos;ve been struggling with food or eating lately
        </label>
      )}

      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="sm">
        Log check-in
      </Button>
    </form>
  );
}
