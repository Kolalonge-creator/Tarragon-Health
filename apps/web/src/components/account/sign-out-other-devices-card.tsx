"use client";

import { useActionState } from "react";
import { signOutOtherSessions } from "./session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Lets a signed-in user revoke every session but this one — a self-service
 * response to "I think I left myself signed in somewhere" without needing to
 * change their password. Feedback pattern (inline success/error text under
 * the form, useActionState) matches ChangePasswordForm/MfaSettingsCard right
 * above it on /account rather than introducing a toast library.
 */
export function SignOutOtherDevicesCard() {
  const [state, formAction, pending] = useActionState(signOutOtherSessions, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign out everywhere else</CardTitle>
        <CardDescription>
          This won&apos;t sign you out here, only on your other devices and browsers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">
              Done. Every other device and browser has been signed out.
            </p>
          )}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Signing out other devices…" : "Sign out everywhere else"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
