"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { backToDryRunAction, confirmBasisAction, goLiveAction, setHubspotSwitchAction, setMasterSwitchAction, type FollowUpActionState } from "./actions";

function Result({ state }: { state: FollowUpActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  return <p role="status" className="text-sm text-deep-forest">{state.done}</p>;
}

export function MasterSwitch({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(setMasterSwitchAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Button type="submit" variant={enabled ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : enabled ? "Turn follow-ups off" : "Turn follow-ups on"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function GoLive({ heldBack }: { heldBack: number }) {
  const [state, action, pending] = useActionState(goLiveAction, undefined);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-night-card">
      <p className="text-sm">
        Going live sends real emails to real people. {heldBack} email{heldBack === 1 ? " is" : "s are"} being held back by dry-run and will go out at the next run.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4" />
        <span>I have read the approved emails and I want them sent.</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Going live…" : "Go live"}</Button>
      <Result state={state} />
    </form>
  );
}

export function BackToDryRun() {
  const [state, action, pending] = useActionState(backToDryRunAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Back to dry-run (stop sending)"}</Button>
      <Result state={state} />
    </form>
  );
}

export function ConfirmBasis() {
  const [state, action, pending] = useActionState(confirmBasisAction, undefined);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-night-card">
      <p className="text-sm">
        Before anyone is followed up, the data protection officer must confirm that the sign-up terms tell people we may email them about setting up and using their
        account. Until then the system finds nobody and records no consent.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4" />
        <span>As data protection officer, I confirm the sign-up terms cover account-setup emails.</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Confirm"}</Button>
      <Result state={state} />
    </form>
  );
}

export function HubspotSwitch({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(setHubspotSwitchAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Button type="submit" variant={enabled ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : enabled ? "Turn HubSpot sync off" : "Turn HubSpot sync on"}
      </Button>
      <Result state={state} />
    </form>
  );
}
