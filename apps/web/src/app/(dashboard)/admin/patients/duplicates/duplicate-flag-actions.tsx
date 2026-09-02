"use client";

import Link from "next/link";
import { useActionState } from "react";
import { dismissDuplicateFlag } from "./actions";
import { Button } from "@/components/ui/button";

export function DuplicateFlagActions({
  flagId,
  profileIdA,
  profileIdB,
}: {
  flagId: string;
  profileIdA: string;
  profileIdB: string;
}) {
  const [state, formAction, pending] = useActionState(dismissDuplicateFlag, undefined);

  return (
    <div className="flex items-center gap-2 pt-1">
      <Link
        href={`/admin/patients/merge?a=${profileIdA}&b=${profileIdB}`}
        className="inline-flex items-center rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-deep-forest"
      >
        Review &amp; merge
      </Link>
      <form action={formAction}>
        <input type="hidden" name="id" value={flagId} />
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Not a duplicate
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
