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
import { usePlusCollectionStates } from "@/lib/queries/service-regions";

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
  const plusStates = usePlusCollectionStates();
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="base" value={base} />
      <p className="text-sm font-medium text-charcoal-ink">Grant membership</p>
      <div>
        <Label htmlFor={`grant-tier-${patientId}`}>Plan</Label>
        <select id={`grant-tier-${patientId}`} name="tier" defaultValue="plus" className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2">
          <option value="plus">Membership Plus (with the yearly blood panel)</option>
          <option value="evergreen">Membership (without the yearly blood panel)</option>
        </select>
      </div>
      <div>
        <Label htmlFor={`grant-state-${patientId}`}>Collection state (Membership Plus only)</Label>
        <select id={`grant-state-${patientId}`} name="collection_state" defaultValue="" className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2">
          <option value="">Choose a state</option>
          {(plusStates.data ?? []).map((s) => (
            <option key={s.state} value={s.state}>{s.display_name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-charcoal-ink/60">Required for Membership Plus while Plus is limited by state. The person&apos;s blood tests are collected here and it stays fixed. Ignored for Membership.</p>
      </div>
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
