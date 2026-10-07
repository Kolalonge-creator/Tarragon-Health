"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  endMembership,
  grantMembership,
  type MembershipActionState,
} from "@/app/(dashboard)/admin/memberships/actions";
import type { MembersBasePath } from "@/lib/memberships/members";

function Feedback({ state }: { state: MembershipActionState }) {
  return (
    <>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
    </>
  );
}

export function GrantMembershipForm({ patientId, base }: { patientId: string; base: MembersBasePath }) {
  const [state, action, pending] = useActionState<MembershipActionState, FormData>(grantMembership, undefined);
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="base" value={base} />
      <p className="text-sm font-medium text-charcoal-ink">Grant membership</p>
      <div>
        <Label htmlFor={`grant-end-${patientId}`}>Ends on (optional, leave empty for no end date)</Label>
        <Input id={`grant-end-${patientId}`} name="ends_on" type="date" />
      </div>
      <div>
        <Label htmlFor={`grant-reason-${patientId}`}>Reason (10 characters or more)</Label>
        <Textarea id={`grant-reason-${patientId}`} name="reason" rows={2} minLength={10} maxLength={1000} required />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Granting..." : "Grant membership"}
      </Button>
    </form>
  );
}

export function EndMembershipForm({ patientId, base }: { patientId: string; base: MembersBasePath }) {
  const [state, action, pending] = useActionState<MembershipActionState, FormData>(endMembership, undefined);
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="base" value={base} />
      <p className="text-sm font-medium text-charcoal-ink">End membership</p>
      <div>
        <Label htmlFor={`end-reason-${patientId}`}>Reason (10 characters or more)</Label>
        <Textarea id={`end-reason-${patientId}`} name="reason" rows={2} minLength={10} maxLength={1000} required />
      </div>
      <Feedback state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Ending..." : "End membership"}
      </Button>
    </form>
  );
}
