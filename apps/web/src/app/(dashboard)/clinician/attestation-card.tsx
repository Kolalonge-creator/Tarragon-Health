"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signAttestation } from "./attestation-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Doctor red-flag attestation (AHC pathway §26). Shows the caller's current
 * attestation status and lets them sign/re-sign. Rendered only for an active
 * clinical_staff member. `expiresAt` is the current attestation's expiry, or
 * null if they have never signed / it has lapsed.
 */
export function AttestationCard({ expiresAt }: { expiresAt: string | null }) {
  const [state, formAction, pending] = useActionState(signAttestation, undefined);
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
        <CardTitle className="text-base">Red-flag attestation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {current ? (
          <p className="text-charcoal-ink/70">
            Signed and current — valid until {expiryLabel}.
          </p>
        ) : (
          <p className="text-charcoal-ink/70">
            {expiresAt
              ? `Your attestation lapsed on ${expiryLabel}. Re-sign to keep delivering health checks.`
              : "Sign your annual attestation before delivering health checks."}
          </p>
        )}
        <p className="text-charcoal-ink/60">
          I confirm I will practise evidence-based, high-value screening; deliver sensitive
          results (HIV, hepatitis, cancer) personally with linkage to care; act on every red
          flag; and never leave an abnormal result without a closed-loop plan.
        </p>
        <form action={formAction}>
          <Button type="submit" disabled={pending} variant={current ? "outline" : "default"}>
            {pending ? "Signing…" : current ? "Re-sign attestation" : "Sign attestation"}
          </Button>
        </form>
        {state?.error && <p className="text-red-600">{state.error}</p>}
        {state?.success && <p className="text-brand-green">Attestation recorded — thank you.</p>}
      </CardContent>
    </Card>
  );
}
