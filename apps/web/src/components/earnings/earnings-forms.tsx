"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approveFeeSchedule,
  discardFeeScheduleDraft,
  postEarningsAdjustment,
  saveFeeScheduleDraft,
  type EarningsActionState,
} from "@/app/(dashboard)/admin/earnings/actions";
import { CONSULTATION_TYPES, type FeeItems } from "@/lib/earnings/earnings";

function Feedback({ state }: { state: EarningsActionState }) {
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

const naira = (kobo: number | undefined): string => (kobo === undefined ? "" : String(kobo / 100));

/** The schedule form. Amounts are typed in naira and become whole kobo on the server; a blank money box is refused, never read as zero. */
export function FeeScheduleForm({ taskTypes, start, draftId, note }: { taskTypes: readonly string[]; start: FeeItems | null; draftId: string | null; note: string | null }) {
  const [state, action, pending] = useActionState<EarningsActionState, FormData>(saveFeeScheduleDraft, undefined);
  const key = useId();
  return (
    <form action={action} className="space-y-4">
      {draftId && <input type="hidden" name="draft_id" value={draftId} />}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-charcoal-ink/60">
              <th className="py-1 pr-2 font-medium">Task type</th>
              <th className="py-1 pr-2 font-medium">Fee (naira)</th>
              <th className="py-1 pr-2 font-medium" colSpan={2}>First step: after this % of the time has passed, add this %</th>
              <th className="py-1 font-medium" colSpan={2}>Second step: after this %, add this %</th>
            </tr>
          </thead>
          <tbody>
            {taskTypes.map((code) => {
              const entry = start?.task_types[code];
              const s1 = entry?.wait_multiplier_steps[0];
              const s2 = entry?.wait_multiplier_steps[1];
              return (
                <tr key={code} className="align-top">
                  <td className="py-1 pr-2 font-mono text-xs">{code}</td>
                  <td className="py-1 pr-2"><Input aria-label={`${code} fee in naira`} name={`base_${code}`} inputMode="decimal" defaultValue={naira(entry?.base_fee_kobo)} className="w-28" /></td>
                  <td className="py-1 pr-1"><Input aria-label={`${code} first step after percent`} name={`step1_at_${code}`} inputMode="numeric" defaultValue={s1?.at_pct ?? ""} className="w-16" /></td>
                  <td className="py-1 pr-2"><Input aria-label={`${code} first step add percent`} name={`step1_add_${code}`} inputMode="numeric" defaultValue={s1?.add_pct ?? ""} className="w-16" /></td>
                  <td className="py-1 pr-1"><Input aria-label={`${code} second step after percent`} name={`step2_at_${code}`} inputMode="numeric" defaultValue={s2?.at_pct ?? ""} className="w-16" /></td>
                  <td className="py-1"><Input aria-label={`${code} second step add percent`} name={`step2_add_${code}`} inputMode="numeric" defaultValue={s2?.add_pct ?? ""} className="w-16" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        A step is read when the clinician takes the task, so finishing slowly never pays more. 100 means the due time has been reached. Leave a step empty for none.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${key}-oc`}>On-call shift fee (naira)</Label><Input id={`${key}-oc`} name="on_call_shift_fee" inputMode="decimal" defaultValue={naira(start?.on_call_shift_fee_kobo)} /></div>
        <div><Label htmlFor={`${key}-lead`}>Lead fee per patient per month (naira)</Label><Input id={`${key}-lead`} name="lead_fee" inputMode="decimal" defaultValue={naira(start?.lead_fee_per_patient_month_kobo)} /></div>
        <div><Label htmlFor={`${key}-min`}>Pilot minimum per declared hour (naira)</Label><Input id={`${key}-min`} name="pilot_minimum" inputMode="decimal" defaultValue={naira(start?.pilot_minimum_per_declared_hour_kobo)} /></div>
      </div>
      <div className="max-w-sm">
        <Label htmlFor={`${key}-creator`}>Fee for each approved, published learning item (naira, optional)</Label>
        <Input id={`${key}-creator`} name="creator_item_fee" inputMode="decimal" defaultValue={naira(start?.creator_item_published_fee_kobo)} />
        <p className="mt-1 text-xs text-charcoal-ink/60">Paid once per item to a contracted clinician who created it. Left blank, those lines are flagged for you to correct.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {CONSULTATION_TYPES.map((type) => (
          <div key={type} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
            <p className="text-sm font-medium capitalize">{type} consultation</p>
            <div><Label htmlFor={`${key}-sh-${type}`}>Share of the price (whole percent)</Label><Input id={`${key}-sh-${type}`} name={`share_${type}`} inputMode="numeric" defaultValue={start?.consultation_share_pct[type] ?? ""} /></div>
            <div><Label htmlFor={`${key}-ref-${type}`}>Reference price if none was paid (naira, optional)</Label><Input id={`${key}-ref-${type}`} name={`reference_${type}`} inputMode="decimal" defaultValue={naira(start?.consultation_reference_price_kobo?.[type])} /></div>
          </div>
        ))}
      </div>
      <div>
        <Label htmlFor={`${key}-note`}>Note (optional)</Label>
        <Textarea id={`${key}-note`} name="note" rows={2} maxLength={1000} defaultValue={note ?? ""} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : draftId ? "Save draft" : "Save as a new draft"}</Button>
    </form>
  );
}

export function ApproveForm({ scheduleId, version }: { scheduleId: string; version: number }) {
  const [state, action, pending] = useActionState<EarningsActionState, FormData>(approveFeeSchedule, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="schedule_id" value={scheduleId} />
      <p className="text-sm text-charcoal-ink/70">Approving makes version {version} the schedule for work finished from this moment. It can never be edited afterwards.</p>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Approving..." : `Approve version ${version}`}</Button>
    </form>
  );
}

export function DiscardForm({ scheduleId }: { scheduleId: string }) {
  const [state, action, pending] = useActionState<EarningsActionState, FormData>(discardFeeScheduleDraft, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="schedule_id" value={scheduleId} />
      <Feedback state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? "Discarding..." : "Discard draft"}</Button>
    </form>
  );
}

/** requestId is made fresh on every server render, so a double click posts once and the next page load can post again. */
export function AdjustmentForm({ clinicians, corrects, defaultClinician, requestId }: { clinicians: ReadonlyArray<{ id: string; name: string }>; corrects?: string; defaultClinician?: string; requestId: string }) {
  const [state, action, pending] = useActionState<EarningsActionState, FormData>(postEarningsAdjustment, undefined);
  const key = useId();
  return (
    <form action={action} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <input type="hidden" name="request_id" value={requestId} />
      {corrects && <input type="hidden" name="corrects" value={corrects} />}
      <p className="text-sm font-medium text-charcoal-ink">{corrects ? "Correct this line" : "Post an adjustment"}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${key}-who`}>Clinician</Label>
          <select id={`${key}-who`} name="clinician_id" defaultValue={defaultClinician} required className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm">
            {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${key}-dir`}>Direction</Label>
          <select id={`${key}-dir`} name="direction" className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm">
            <option value="add">Add to their earnings</option>
            <option value="take_away">Take away (a correction)</option>
          </select>
        </div>
        <div><Label htmlFor={`${key}-amt`}>Amount (naira)</Label><Input id={`${key}-amt`} name="amount" inputMode="decimal" required /></div>
      </div>
      <div>
        <Label htmlFor={`${key}-why`}>Reason (10 characters or more)</Label>
        <Textarea id={`${key}-why`} name="reason" rows={2} minLength={10} maxLength={1000} required />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Posting..." : "Post adjustment"}</Button>
    </form>
  );
}
