"use client";

import { useActionState } from "react";
import { standDownFlag, type StandDownState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface OpenFlag {
  id: string;
  patientName: string;
  ruleKey: string;
  severity: string;
  escalationLevel: number;
  action: string;
  openedAt: string;
}

function severityTone(severity: string): "amber" | "red" | "grey" {
  if (severity === "emergency" || severity === "red") return "red";
  if (severity === "amber") return "amber";
  return "grey";
}

export function LifestyleFlagsClient({ flags }: { flags: OpenFlag[] }) {
  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          Nothing waiting. All lifestyle safety flags have been reviewed.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {flags.map((f) => (
        <FlagRow key={f.id} flag={f} />
      ))}
    </div>
  );
}

function FlagRow({ flag }: { flag: OpenFlag }) {
  const [state, submit] = useActionState<StandDownState, FormData>(
    standDownFlag,
    undefined,
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{flag.patientName}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={severityTone(flag.severity)}>{flag.severity}</Badge>
          <Badge variant="grey">Level {flag.escalationLevel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">{flag.ruleKey}</span>
          {flag.action === "auto_pause_weightloss" && (
            <span className="text-muted-foreground">
              {" "}
              · weight-loss auto-paused
            </span>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          Opened {new Date(flag.openedAt).toLocaleString()}
        </p>
        <form action={submit} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="flagId" value={flag.id} />
          <div className="flex-1 min-w-[200px]">
            <Input name="reason" placeholder="Reason (e.g. contacted patient, safe)" />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Stand down
          </Button>
        </form>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}
