"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { LEAVE_TYPE_LABEL, LEAVE_TYPES, type LeaveType } from "@/lib/people/leave";
import { cancelLeave, decideLeave, requestLeave, type LeaveActionState } from "@/lib/people/leave-actions";

const SELECT = "min-h-11 w-full rounded-md border px-3 py-2 text-sm";

export function LeaveRequestForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<LeaveActionState, FormData>(requestLeave, undefined);
  const [type, setType] = useState<LeaveType>("annual");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1 text-sm">
        <label htmlFor="leaveType" className="font-medium">Kind of leave</label>
        <select id="leaveType" name="leaveType" value={type} className={SELECT}
          onChange={(e) => setType(LEAVE_TYPES.find((t) => t === e.target.value) ?? "annual")}>
          {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor="startsOn" className="font-medium">First day</label>
        <Input id="startsOn" name="startsOn" type="date" defaultValue={today} required />
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor="endsOn" className="font-medium">Last day</label>
        <Input id="endsOn" name="endsOn" type="date" defaultValue={today} required />
      </div>
      <div className="space-y-1 text-sm sm:col-span-3">
        <label htmlFor="note" className="font-medium">Note for your manager (optional)</label>
        <Input id="note" name="note" maxLength={500} placeholder="For example who covers your work" />
        <p className="text-xs text-charcoal-ink/60">Your manager can see this note. Do not put health details here.</p>
      </div>
      {type === "sick" && (
        <div className="space-y-1 text-sm sm:col-span-3">
          <label htmlFor="sicknessReason" className="font-medium">Reason for sick leave (optional)</label>
          <Input id="sicknessReason" name="sicknessReason" maxLength={500} />
          <p className="text-xs text-charcoal-ink/60">Only you and an admin can see this. Your manager sees only that it is sick leave.</p>
        </div>
      )}
      <p className="text-xs text-charcoal-ink/60 sm:col-span-3">
        Sick leave can be recorded up to 30 days afterwards. Other leave is asked for before it starts. Days are counted Monday to Friday.
      </p>
      <div className="space-y-2 sm:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? "Sending..." : "Ask for leave"}</Button>
        <FormError id="leave-error" message={state?.error} />
        <FormSuccess message={state?.message} />
      </div>
    </form>
  );
}

export function CancelLeaveButton({ requestId, label = "Cancel" }: { requestId: string; label?: string }) {
  const [state, action, pending] = useActionState<LeaveActionState, FormData>(cancelLeave, undefined);
  return (
    <form action={action} className="inline-flex flex-col">
      <input type="hidden" name="requestId" value={requestId} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Cancelling..." : label}</Button>
      <FormError id={`cl-${requestId}`} message={state?.error} />
    </form>
  );
}

/**
 * Approve or decline. For a clinician, `cancellations` is how many booked appointments approval will cancel (shown, and sent
 * back so the database can refuse if bookings changed meanwhile); null means it could not be worked out, so approval is not
 * offered until the page is reloaded.
 */
export function DecideLeaveForm({
  requestId,
  cancellations,
  isClinician,
  rotaShifts = 0,
}: {
  requestId: string;
  cancellations: number | null;
  isClinician: boolean;
  /** On-call shifts in the period (null: could not be checked). Approval does not change the rota; the approver is told. */
  rotaShifts?: number | null;
}) {
  const [state, action, pending] = useActionState<LeaveActionState, FormData>(decideLeave, undefined);
  const canApprove = !isClinician || cancellations !== null;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expectedCancellations" value={cancellations ?? 0} />
      {isClinician && cancellations === null && (
        <p className="text-sm text-red-700">We could not check this clinician&apos;s bookings, so approval is not available. Reload the page to try again.</p>
      )}
      {isClinician && cancellations !== null && cancellations > 0 && (
        <p className="text-sm font-medium text-red-700">
          Approving cancels {cancellations} booked {cancellations === 1 ? "appointment" : "appointments"} in this period. The patients are told the
          clinician is on leave, paid video consultations are credited back, and they are offered the waiting list.
        </p>
      )}
      {isClinician && cancellations === 0 && <p className="text-sm text-charcoal-ink/70">No booked appointments fall in this period.</p>}
      {isClinician && rotaShifts !== null && rotaShifts > 0 && (
        <p className="text-sm font-medium text-red-700">
          They are on the on-call rota for {rotaShifts} {rotaShifts === 1 ? "shift" : "shifts"} in this period. Approving does not change the rota: rearrange
          cover on the <a href="/admin/rota" className="underline">rota page</a>.
        </p>
      )}
      {isClinician && rotaShifts === null && <p className="text-sm text-red-700">We could not check the on-call rota for this period; check it before approving.</p>}
      <label className="sr-only" htmlFor={`dn-${requestId}`}>Note</label>
      <Input id={`dn-${requestId}`} name="note" maxLength={500} placeholder="Note (needed if you do not approve)" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approved" disabled={pending || !canApprove}>
          {cancellations ? `Approve and cancel ${cancellations}` : "Approve"}
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="outline" disabled={pending}>Do not approve</Button>
      </div>
      <FormError id={`de-${requestId}`} message={state?.error} />
      <FormSuccess message={state?.message} />
    </form>
  );
}
