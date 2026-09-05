"use client";

import { useActionState } from "react";
import { standDownFlag, type StandDownState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  compareLifestyleFlags,
  lifestyleSeverityLabel,
  lifestyleSeverityVariant,
} from "@/lib/worklist/lifestyle-flag-rank";
import { timeAgo } from "@/lib/worklist/sla-label";

export interface OpenFlag {
  id: string;
  patientName: string;
  ruleKey: string;
  severity: string;
  escalationLevel: number;
  action: string;
  openedAt: string;
}

export function LifestyleFlagsClient({ flags }: { flags: OpenFlag[] }) {
  // The page fetches oldest-first, which put an emergency flag raised this
  // morning below last week's amber one. Severity leads; age only breaks ties.
  const ranked = flags.slice().sort(compareLifestyleFlags);

  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="text-charcoal-ink/60 py-8 text-center text-sm">
          Nothing waiting. All lifestyle safety flags have been reviewed.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {ranked.map((f) => (
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
          <Badge variant={lifestyleSeverityVariant(flag.severity)}>
            {lifestyleSeverityLabel(flag.severity)}
          </Badge>
          <Badge variant="grey">Level {flag.escalationLevel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">{flag.ruleKey}</span>
          {flag.action === "auto_pause_weightloss" && (
            <span className="text-charcoal-ink/60">
              {" "}
              · weight-loss auto-paused
            </span>
          )}
        </p>
        <p className="text-charcoal-ink/60 text-xs">
          Open {timeAgo(flag.openedAt)} (opened {new Date(flag.openedAt).toLocaleString()})
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
