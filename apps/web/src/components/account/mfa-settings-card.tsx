"use client";

import { useActionState, useState } from "react";
import { startMfaEnrollment, verifyMfaEnrollment, turnOffMfa, type MfaEnrollState } from "./mfa-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { APP_ICON } from "@/lib/icons";

export function MfaSettingsCard({ verifiedFactorId }: { verifiedFactorId: string | null }) {
  if (verifiedFactorId) {
    return <MfaEnabledView factorId={verifiedFactorId} />;
  }
  return <MfaSetupView />;
}

function MfaEnabledView({ factorId }: { factorId: string }) {
  const [state, formAction, pending] = useActionState(turnOffMfa, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <APP_ICON.security className="h-4 w-4 text-brand-green" />
          Two-factor authentication
          <Badge variant="green">On</Badge>
        </CardTitle>
        <CardDescription>
          Your account is protected with an authenticator app, on top of your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="factorId" value={factorId} />
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Turning off…" : "Turn off two-factor authentication"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MfaSetupView() {
  const [enrollState, setEnrollState] = useState<MfaEnrollState>(undefined);
  const [starting, setStarting] = useState(false);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyMfaEnrollment, undefined);

  // A successful verify swaps the factor from unverified to verified, but
  // this card only knows that from a fresh server render — the simplest
  // reliable way to reflect it is to reload straight into MfaEnabledView.
  if (verifyState?.success) {
    if (typeof window !== "undefined") window.location.reload();
    return (
      <Card>
        <CardContent className="py-6 text-sm text-charcoal-ink/60">
          Two-factor authentication is on. Refreshing…
        </CardContent>
      </Card>
    );
  }

  async function handleStart() {
    setStarting(true);
    const result = await startMfaEnrollment();
    setEnrollState(result);
    setStarting(false);
  }

  if (enrollState?.step === "enrolling") {
    const qrDataUri = `data:image/svg+xml;utf-8,${encodeURIComponent(enrollState.qrCode)}`;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <APP_ICON.security className="h-4 w-4 text-brand-green" />
            Set up two-factor authentication
          </CardTitle>
          <CardDescription>
            Scan this with an authenticator app (Google Authenticator, Authy, or similar), then
            enter the 6-digit code it shows you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not a Next-optimizable remote/local asset */}
          <img
            src={qrDataUri}
            alt="Scan with your authenticator app"
            width={180}
            height={180}
            className="rounded-lg border border-charcoal-ink/10"
          />
          <div className="space-y-1">
            <p className="text-xs text-charcoal-ink/50">Can&apos;t scan? Enter this key instead:</p>
            <code className="block rounded-lg bg-charcoal-ink/5 px-3 py-2 text-xs break-all">
              {enrollState.secret}
            </code>
          </div>

          <form action={verifyAction} className="max-w-xs space-y-3">
            <input type="hidden" name="factorId" value={enrollState.factorId} />
            <div className="space-y-1.5">
              <Label htmlFor="mfa-setup-code">6-digit code</Label>
              <Input
                id="mfa-setup-code"
                name="code"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                required
              />
            </div>
            {verifyState?.error && <p className="text-sm text-red-600">{verifyState.error}</p>}
            <Button type="submit" disabled={verifyPending}>
              {verifyPending ? "Verifying…" : "Verify & turn on"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <APP_ICON.security className="h-4 w-4 text-charcoal-ink/40" />
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          Optional extra protection for your account using an authenticator app on your phone.
          Turn it on whenever you&apos;re ready — your password still works on its own until you do.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {enrollState?.error && <p className="mb-3 text-sm text-red-600">{enrollState.error}</p>}
        <Button type="button" variant="outline" onClick={handleStart} disabled={starting}>
          {starting ? "Starting…" : "Set up two-factor authentication"}
        </Button>
      </CardContent>
    </Card>
  );
}
