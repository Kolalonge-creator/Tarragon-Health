"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestDedicatedAccountAction } from "./dedicated-account-actions";

export function RequestDedicatedAccountButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div>
      <Button
        size="sm"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            const result = await requestDedicatedAccountAction();
            if (result?.error) setError(result.error);
            else setDone(true);
          })
        }
      >
        {pending ? "Setting up…" : done ? "Refresh the page to see it" : "Get my transfer number"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
