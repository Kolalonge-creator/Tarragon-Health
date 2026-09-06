"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setPopulationStatusAction, type SetPopulationStatusState } from "../actions";

/** A registry is never deleted (spec §41.4) — this only toggles whether it's still tracked as live. */
export function ArchiveButton({
  populationId,
  status,
}: {
  populationId: string;
  status: "active" | "archived";
}) {
  const nextStatus = status === "active" ? "archived" : "active";
  const [state, action, pending] = useActionState<SetPopulationStatusState, FormData>(
    () => setPopulationStatusAction(populationId, nextStatus),
    undefined
  );
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "…" : status === "active" ? "Archive" : "Restore"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
