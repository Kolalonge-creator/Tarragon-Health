"use client";

import { useActionState, useState } from "react";
import { setPregnancyStatus } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PregnancyForm({
  initialIsPregnant,
  initialEdd,
}: {
  initialIsPregnant: boolean;
  initialEdd: string | null;
}) {
  const [state, action, pending] = useActionState(setPregnancyStatus, undefined);
  const [isPregnant, setIsPregnant] = useState(initialIsPregnant);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="is_pregnant" value={isPregnant ? "true" : "false"} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPregnant}
          onChange={(e) => setIsPregnant(e.target.checked)}
        />
        I am pregnant
      </label>
      {isPregnant && (
        <div className="space-y-1.5">
          <Label htmlFor="estimated_due_date">Estimated due date (if known)</Label>
          <Input
            id="estimated_due_date"
            name="estimated_due_date"
            type="date"
            defaultValue={initialEdd ?? ""}
          />
        </div>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
      <Button type="submit" disabled={pending} variant="outline" size="sm">
        {pending ? "Saving…" : "Update"}
      </Button>
    </form>
  );
}
