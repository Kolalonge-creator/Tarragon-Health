"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptHandoverAction, declineHandoverAction } from "./handover-actions";

export interface PendingHandover {
  id: string;
  guardian_first_name: string | null;
  expires_at: string;
}

function HandoverItem({ handover }: { handover: PendingHandover }) {
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptHandoverAction, undefined);
  const [declineState, declineAction, declinePending] = useActionState(declineHandoverAction, undefined);
  const name = handover.guardian_first_name || "Someone";
  const done = acceptState?.done ?? declineState?.done;

  if (done) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="status" className="text-sm">
            {done === "accepted"
              ? "Your record is now your own. Only you can see it, and you choose who else can."
              : `Thank you. Nothing has changed, and ${name} still looks after the record for now.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  const pending = acceptPending || declinePending;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{name} kept a health record for you</CardTitle>
        <CardDescription>
          You are an adult now, so it is yours to take over. Until you say yes, nothing changes and {name} still looks
          after it. Once you say yes it becomes your own account record, and you choose who can see it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={acceptAction} className="space-y-4">
          <input type="hidden" name="handoverId" value={handover.id} />
          {(acceptState?.error || declineState?.error) && (
            <p role="alert" className="text-sm text-red-700">
              {acceptState?.error ?? declineState?.error}
            </p>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={pending} className="rounded-xl">
              Take over my record
            </Button>
            <Button type="submit" variant="outline" formAction={declineAction} formNoValidate disabled={pending} className="rounded-xl">
              Not now
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Shown to the young person once they have signed in on the number their guardian entered (S04b-1, R3). */
export function HandoverCard({ handovers }: { handovers: PendingHandover[] }) {
  if (handovers.length === 0) return null;
  return (
    <div className="space-y-4">
      {handovers.map((handover) => (
        <HandoverItem key={handover.id} handover={handover} />
      ))}
    </div>
  );
}
