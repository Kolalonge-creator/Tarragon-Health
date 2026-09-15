"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signHtnAttestation } from "./htn-attestation-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Hypertension red-flag competency attestation (H17, TH-CP-HTN-001 §14.7/§23).
 * `enforce_htn_alert_attestation` (a DB trigger on `clinician_alerts`) blocks
 * acknowledging a blood-pressure-sourced alert until this is signed and current
 * — so an un-signed doctor isn't just missing a nice-to-have, they will hit a
 * hard error the first time a real BP emergency alert reaches their queue.
 * Rendered only for an active clinical_staff member, same as AttestationCard.
 */
export function HtnAttestationCard({ expiresAt }: { expiresAt: string | null }) {
  const [state, formAction, pending] = useActionState(signHtnAttestation, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const current = expiresAt !== null && new Date(expiresAt) > new Date();
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <Card variant={current ? "soft" : "default"}>
      <CardHeader>
        <CardTitle className="text-base">Hypertension red-flag attestation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {current ? (
          <p className="text-charcoal-ink/70">Signed and current, valid until {expiryLabel}.</p>
        ) : (
          <p className="text-amber-800">
            {expiresAt
              ? `Your attestation lapsed on ${expiryLabel}. Re-sign before acknowledging any BP-sourced alert.`
              : "Sign this before acknowledging a blood-pressure-sourced clinical alert — the system will " +
                "reject the acknowledgement otherwise."}
          </p>
        )}
        <p className="text-charcoal-ink/60">
          I confirm I know and will act on the hypertension pathway&rsquo;s red flags (§14): a
          hypertensive-crisis reading (&ge;180/120) or a symptomatic low reading, the secondary-cause
          screening triggers, the ACE-inhibitor/ARB combination and pregnancy prescribing blocks, and the
          renal-safety stop-thresholds for ARBs and thiazides. A red flag cannot be auto-closed or
          downgraded.
        </p>
        <form action={formAction}>
          <Button type="submit" disabled={pending} variant={current ? "outline" : "default"}>
            {pending ? "Signing…" : current ? "Re-sign attestation" : "Sign attestation"}
          </Button>
        </form>
        {state?.error && <p className="text-red-600">{state.error}</p>}
        {state?.success && <p className="text-brand-green">Attestation recorded, thank you.</p>}
      </CardContent>
    </Card>
  );
}
