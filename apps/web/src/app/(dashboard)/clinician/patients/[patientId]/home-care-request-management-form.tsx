"use client";

import { useActionState, useState } from "react";
import { updateHomeCareRequest } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { HOME_CARE_STATUS_LABEL, type HomeCareRequestStatus } from "@/lib/healthy-ageing/types";

const NEXT_STATUS_OPTIONS: Partial<Record<HomeCareRequestStatus, HomeCareRequestStatus[]>> = {
  eligibility_pending: ["eligible", "ineligible"],
  eligible: ["scheduled"],
  scheduled: ["visit_completed"],
};

export function HomeCareRequestManagementForm({
  requestId,
  currentStatus,
}: {
  requestId: string;
  currentStatus: HomeCareRequestStatus;
}) {
  const [state, formAction, pending] = useActionState(updateHomeCareRequest, undefined);
  const options = NEXT_STATUS_OPTIONS[currentStatus] ?? [];
  const [nextStatus, setNextStatus] = useState<HomeCareRequestStatus | "">("");

  if (options.length === 0) return null;

  return (
    <form action={formAction} className="mt-2 space-y-1.5">
      <input type="hidden" name="request_id" value={requestId} />
      <Select
        name="status"
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value as HomeCareRequestStatus)}
      >
        <option value="" disabled>
          Choose next step
        </option>
        {options.map((s) => (
          <option key={s} value={s}>
            {HOME_CARE_STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      {(nextStatus === "eligible" || nextStatus === "ineligible") && (
        <Textarea name="eligibility_notes" placeholder="Eligibility notes" maxLength={500} />
      )}
      {nextStatus === "scheduled" && <Input type="date" name="scheduled_at" aria-label="Visit date" />}
      {nextStatus === "visit_completed" && (
        <Textarea name="visit_notes" placeholder="Visit notes" maxLength={500} />
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">Updated.</p>}
      <Button type="submit" size="sm" disabled={pending || !nextStatus}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
