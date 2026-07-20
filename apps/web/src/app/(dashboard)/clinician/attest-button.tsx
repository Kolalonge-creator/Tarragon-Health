"use client";

import { useState, useTransition } from "react";
import { attestRedFlags } from "./attestation-actions";
import { Button } from "@/components/ui/button";

export function AttestButton({ alreadyCurrent }: { alreadyCurrent: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant={alreadyCurrent ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await attestRedFlags();
            setMsg(res?.error ?? (res?.success ? "Attestation recorded." : null));
          })
        }
      >
        {pending ? "Saving…" : alreadyCurrent ? "Re-attest" : "I attest"}
      </Button>
      {msg && <p className="text-xs text-charcoal-ink/60">{msg}</p>}
    </div>
  );
}
