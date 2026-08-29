"use client";

import { useActionState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerParticipantAction } from "../../actions";

/** One-screen operator flow for the on-site coordinator: phone, name,
 * consent, submit — designed for the "under 60 seconds per person" the
 * revenue-architecture spec calls for. Not offline-tolerant (a known,
 * deliberately-scoped-out gap — see the screening-events schema migration's
 * comment on what V1 does and doesn't cover). */
export function RegisterParticipantForm({
  eventId,
  registeredCount,
  headcountTarget,
}: {
  eventId: string;
  registeredCount: number;
  headcountTarget: number;
}) {
  const action = registerParticipantAction.bind(null, eventId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const full = registeredCount >= headcountTarget;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a participant</CardTitle>
      </CardHeader>
      <CardContent>
        {full ? (
          <p className="text-sm text-charcoal-ink/70">
            This event has reached its paid-for headcount ({headcountTarget}).
          </p>
        ) : (
          <form
            ref={formRef}
            action={async (formData) => {
              await formAction(formData);
              formRef.current?.reset();
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="space-y-1">
              <Label htmlFor="phone">Phone (E.164)</Label>
              <Input id="phone" name="phone" placeholder="+2348012345678" required autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="consent" required className="h-4 w-4" />
              They&apos;ve agreed to be tested and to Tarragon holding their results.
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Registering…" : "Register"}
              </Button>
              {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
              {state?.message && <p className="mt-2 text-sm text-tarragon-green">{state.message}</p>}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
