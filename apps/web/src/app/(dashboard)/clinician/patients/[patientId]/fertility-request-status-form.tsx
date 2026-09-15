"use client";

import { useActionState } from "react";
import { updateFertilityRequestStatus } from "./womens-health-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const STATUS_OPTIONS = ["requested", "education_provided", "consult_booked", "referred", "closed"] as const;

export function FertilityRequestStatusForm({
  requestId,
  currentStatus,
}: {
  requestId: string;
  currentStatus: string;
}) {
  const boundAction = updateFertilityRequestStatus.bind(null, requestId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="mt-2 flex items-center gap-2">
      <Select name="status" defaultValue={currentStatus} className="h-8 w-auto text-xs">
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Update"}
      </Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
