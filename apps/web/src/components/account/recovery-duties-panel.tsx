"use client";

import { useActionState } from "react";
import { confirmContactRecoveryAction, respondRecoveryContactAction, revokeRecoveryContactAction } from "./recovery-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDateTime } from "@/lib/format-date";

export interface RecoveryDuties {
  proposals: { id: string; patient_name: string | null; since: string }[];
  standing: { id: string; patient_name: string | null; since: string }[];
  requests: { id: string; patient_name: string | null; asked_at: string; expires_at: string }[];
}

const nameOf = (n: string | null) => n?.trim() || "Someone in your Care Circle";

function Proposal({ item }: { item: RecoveryDuties["proposals"][number] }) {
  const [state, act, pending] = useActionState(respondRecoveryContactAction, undefined);
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/15 p-4">
      <p className="text-sm">
        {nameOf(item.patient_name)} asked if you will be their account recovery contact. If they are ever locked out, you may be asked
        to confirm it is really them. You never receive a link or a code.
      </p>
      <form action={act} className="flex gap-2">
        <input type="hidden" name="id" value={item.id} />
        <Button type="submit" name="decision" value="accept" disabled={pending}>
          Yes, I will
        </Button>
        <Button type="submit" name="decision" value="decline" variant="outline" disabled={pending}>
          No
        </Button>
      </form>
      <FormError id={`proposal-${item.id}`} message={state?.error} />
    </div>
  );
}

function Standing({ item }: { item: RecoveryDuties["standing"][number] }) {
  const [state, act, pending] = useActionState(revokeRecoveryContactAction, undefined);
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/15 p-4">
      <p className="text-sm">You are {nameOf(item.patient_name)}&apos;s recovery contact.</p>
      <form action={act}>
        <input type="hidden" name="id" value={item.id} />
        <Button type="submit" variant="outline" disabled={pending}>
          Step down
        </Button>
      </form>
      <FormError id={`standing-${item.id}`} message={state?.error} />
    </div>
  );
}

function Request({ item }: { item: RecoveryDuties["requests"][number] }) {
  const [state, act, pending] = useActionState(confirmContactRecoveryAction, undefined);
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
      <p className="font-heading text-base font-semibold">{nameOf(item.patient_name)} needs your help</p>
      <p className="text-sm">
        They say they are locked out of their Tarragon Health account and asked you to confirm it is really them. Asked{" "}
        {formatPatientDateTime(item.asked_at)}. You will not receive a link or a code. After you confirm there is a wait of a day for
        their safety, and the link goes to their own verified email or phone.
      </p>
      <form action={act} className="space-y-3">
        <input type="hidden" name="id" value={item.id} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="sure" className="mt-1 h-4 w-4" />
          <span>I have spoken to them myself, in person or by a call I started, and I am sure it is them.</span>
        </label>
        <div className="flex gap-2">
          <Button type="submit" name="decision" value="confirm" disabled={pending}>
            Confirm it is them
          </Button>
          <Button type="submit" name="decision" value="decline" variant="outline" disabled={pending}>
            Not sure, do not confirm
          </Button>
        </div>
        <FormError id={`request-${item.id}`} message={state?.error} />
      </form>
    </div>
  );
}

/** Recovery contact duties on the supporter's home (S03b). Requests first, because they have a clock on them. */
export function RecoveryDutiesPanel({ duties }: { duties: RecoveryDuties }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery contact</CardTitle>
        <CardDescription>People in your Care Circle who named you to help if they are locked out of their account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {duties.requests.map((r) => (
          <Request key={r.id} item={r} />
        ))}
        {duties.proposals.map((p) => (
          <Proposal key={p.id} item={p} />
        ))}
        {duties.standing.map((s) => (
          <Standing key={s.id} item={s} />
        ))}
      </CardContent>
    </Card>
  );
}
