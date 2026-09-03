"use client";

import { useActionState } from "react";
import { runDuplicateSweep } from "./actions";
import { Button } from "@/components/ui/button";

export function RunSweepButton() {
  const [state, formAction, pending] = useActionState(runDuplicateSweep, undefined);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Scanning…" : "Run sweep now"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
