"use client";

import { useActionState, useState } from "react";
import { signOutOtherSessions, type SignOutOthersState } from "./session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId } from "@/components/ui/form-error";

/**
 * Lets a signed-in user revoke every session but this one — a self-service
 * response to "I think I left myself signed in somewhere" without needing to
 * change their password. Feedback pattern (inline success/error text under
 * the form, useActionState) matches ChangePasswordForm/MfaSettingsCard right
 * above it on /account rather than introducing a toast library.
 *
 * `confirmFirst` (P21, the patient Profile page) asks "are you sure?" before
 * signing anything out. Off by default so /account behaves exactly as before.
 */
export function SignOutOtherDevicesCard({ confirmFirst = false }: { confirmFirst?: boolean } = {}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: SignOutOthersState, fd: FormData) => {
    const r = await signOutOtherSessions(prev, fd);
    if (r?.success) setConfirming(false);
    return r;
  }, undefined);
  const showSubmit = !confirmFirst || confirming;

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
          <FormError id={fieldErrorId("sign-out-others")} message={state?.error} />
          <FormSuccess
            message={state?.success && "Done. Every other device and browser has been signed out."}
          />
          {confirmFirst && confirming ? (
            <p className="text-sm font-medium" role="status">
              Sign out of all your other devices and browsers? You will stay signed in here.
            </p>
          ) : null}
          {showSubmit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? "Signing out other devices…" : confirmFirst ? "Yes, sign them out" : "Sign out everywhere else"}
              </Button>
              {confirmFirst ? (
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              Sign out everywhere else
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
