"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  checkLowCarbEligibility,
  completeLowCarbReview,
  offerLowCarb,
  pauseLowCarb,
  resumeLowCarb,
  runLowCarbReview,
  stopLowCarb,
  type LowCarbActionState,
} from "./actions";

const TOUCH = "min-h-11";

function Result({ state }: { state: LowCarbActionState }) {
  if (!state) return null;
  return (
    <div className="space-y-1 text-sm">
      {state.error ? (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p role="status">{state.message}</p> : null}
      {state.lines && state.lines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {state.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OfferForm({ patientId }: { patientId: string }) {
  const [offerState, offer, offering] = useActionState(offerLowCarb, undefined);
  const [checkState, check, checking] = useActionState(checkLowCarbEligibility, undefined);
  return (
    <div className="space-y-3">
      <form className="space-y-3">
        <input type="hidden" name="patientId" value={patientId} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="noRecentAdmission" className="mt-1 h-5 w-5" />
          <span>I have confirmed there has been no recent severe low sugar and no recent hospital admission.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="supervisionAccepted" className="mt-1 h-5 w-5" />
          <span>I accept supervision of this person&apos;s insulin or sulfonylurea while they follow the programme.</span>
        </label>
        <label className="block text-sm">
          How I will supervise the medicines (needed if you accepted supervision)
          <textarea name="supervisionNote" rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" formAction={check} variant="outline" className={TOUCH} disabled={checking}>
            Check the screen
          </Button>
          <Button type="submit" formAction={offer} className={TOUCH} disabled={offering}>
            Offer the programme
          </Button>
        </div>
      </form>
      <Result state={checkState} />
      <Result state={offerState} />
    </div>
  );
}

function IdForm({ patientId, enrolmentId, action, label, variant }: { patientId: string; enrolmentId: string; action: typeof pauseLowCarb; label: string; variant?: "outline" }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="space-y-1">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <Button type="submit" variant={variant} className={TOUCH} disabled={pending}>
        {label}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function PauseButton(props: { patientId: string; enrolmentId: string }) {
  return <IdForm {...props} action={pauseLowCarb} label="Pause the programme" variant="outline" />;
}
export function ResumeButton(props: { patientId: string; enrolmentId: string }) {
  return <IdForm {...props} action={resumeLowCarb} label="Resume the programme" />;
}
export function StopButton(props: { patientId: string; enrolmentId: string; label?: string }) {
  return <IdForm patientId={props.patientId} enrolmentId={props.enrolmentId} action={stopLowCarb} label={props.label ?? "Stop the programme"} variant="outline" />;
}

export function ReviewForm({ patientId, enrolmentId }: { patientId: string; enrolmentId: string }) {
  const [runState, run, running] = useActionState(runLowCarbReview, undefined);
  const [doneState, complete, completing] = useActionState(completeLowCarbReview, undefined);
  return (
    <div className="space-y-4">
      <form action={run} className="space-y-2">
        <input type="hidden" name="patientId" value={patientId} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="createDrafts" className="mt-1 h-5 w-5" />
          <span>Also create unsigned drafts for the suggestions that can be a proposal. A draft changes nothing until you sign it and the patient confirms it.</span>
        </label>
        <Button type="submit" className={TOUCH} disabled={running}>
          Check the medicines
        </Button>
        <Result state={runState} />
      </form>
      <form action={complete} className="space-y-2">
        <input type="hidden" name="patientId" value={patientId} />
        <input type="hidden" name="enrolmentId" value={enrolmentId} />
        <label className="block text-sm">
          Record that you reviewed the medicines, and what you decided
          <textarea name="note" rows={2} minLength={10} maxLength={2000} required className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
        </label>
        <Button type="submit" variant="outline" className={TOUCH} disabled={completing}>
          Record the review
        </Button>
        <Result state={doneState} />
      </form>
    </div>
  );
}
