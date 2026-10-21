"use client";

import { useState, useTransition } from "react";
import { acknowledgeCriticalCall } from "@/lib/lab-results/lifecycle-actions";
import { formatWaiting, type CriticalCallRow } from "@/lib/lab-results/lifecycle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TOUCH = "min-h-11";

function CallRow({ call }: { call: CriticalCallRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(call.acknowledged_at !== null);
  const role = call.my_role === "called" ? "You were called" : call.my_role === "backup" ? "You are the backup" : "Lead view";
  return (
    <li className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{role}. Open for {formatWaiting(call.minutes_open)}.</p>
        {done ? <Badge variant="green">Acknowledged</Badge> : call.overdue ? <Badge variant="red">Overdue</Badge> : <Badge variant="amber">Waiting</Badge>}
      </div>
      <p className="text-charcoal-ink/70">
        {done
          ? "Acknowledged. The result stays held until a senior clinician releases or holds it back; claim its task to open it."
          : `Acknowledge by ${new Date(call.due_at).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })}, or the backup and then the clinical lead are told.`}
        {call.no_cover ? " Nobody was on the rota when this arrived." : ""}
      </p>
      {!done ? (
        <Button
          type="button"
          className={TOUCH}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await acknowledgeCriticalCall(call.call_id);
              if (r?.success) setDone(true);
              setError(r?.error ?? null);
            })
          }
        >
          Acknowledge
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </li>
  );
}

/** The critical value calls this clinician is on (or every open call, for the clinical lead). Acknowledging records the time; it releases nothing. */
export function CriticalCalls({ calls }: { calls: CriticalCallRow[] }) {
  if (calls.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Critical value calls</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {calls.map((c) => (
            <CallRow key={c.call_id} call={c} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
