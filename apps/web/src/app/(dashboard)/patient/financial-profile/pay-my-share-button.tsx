"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { payMyShare, type FinancialProfileActionState } from "./actions";

export function PayMyShareButton({ contributionId, label }: { contributionId: string; label: string }) {
  const [state, action, pending] = useActionState<FinancialProfileActionState, FormData>(
    payMyShare,
    undefined,
  );

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="contributionId" value={contributionId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Starting…" : label}
      </Button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-300">{state.error}</span>}
    </form>
  );
}
