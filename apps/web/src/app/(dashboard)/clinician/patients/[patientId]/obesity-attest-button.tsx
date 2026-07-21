"use client";

import { useActionState } from "react";
import { signObesityAttestation, type ObesityActionState } from "./obesity-actions";
import { Button } from "@/components/ui/button";

export function ObesityAttestButton() {
  const [state, formAction, pending] = useActionState<ObesityActionState, FormData>(
    () => signObesityAttestation(),
    undefined,
  );
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Attestation signed. Thank you.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing…" : "I attest"}
      </Button>
    </form>
  );
}
