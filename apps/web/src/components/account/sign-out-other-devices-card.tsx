"use client";

import { useActionState } from "react";
import { signOutOtherSessions } from "./session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId } from "@/components/ui/form-error";
import { summarizeUserAgent } from "@/lib/queries/summarize-user-agent";
import { formatPatientDateTime } from "@/lib/format-date";
import type { KnownDevice } from "@/lib/queries/known-devices";

/**
 * Lets a signed-in user revoke every session but this one — a self-service
 * response to "I think I left myself signed in somewhere" without needing to
 * change their password. Feedback pattern (inline success/error text under
 * the form, useActionState) matches ChangePasswordForm/MfaSettingsCard right
 * above it on /account rather than introducing a toast library.
 *
 * 2026-09-18 security audit: this card used to be JUST the button below, with
 * no visibility into what it would actually sign out of. `devices` (from
 * `getKnownDevices`, reading the same `user_known_devices` table the
 * new-device-login notification already writes) closes most of that gap —
 * it's real device HISTORY, not a live session list: Supabase Auth's actual
 * per-session store (`auth.sessions`) has no client-safe read or per-row
 * revoke without the service-role admin API, which is a larger piece of work
 * than this pass — so the one action stays "sign out everywhere else," not a
 * revoke button next to each row. Still a real improvement over a blind
 * button: a patient can now see whether an unfamiliar browser/OS combination
 * shows up before deciding to use it.
 */
export function SignOutOtherDevicesCard({ devices }: { devices: KnownDevice[] }) {
  const [state, formAction, pending] = useActionState(signOutOtherSessions, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Devices and browsers that have signed in to your account, most recent first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {devices.length > 0 ? (
          <ul className="divide-y divide-charcoal-ink/10 rounded-md border border-charcoal-ink/10">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <span className="font-medium text-charcoal-ink">
                  {summarizeUserAgent(device.userAgent)}
                </span>
                <span className="text-xs text-charcoal-ink/50">
                  Last seen {formatPatientDateTime(device.lastSeenAt)}
                  {device.lastIp ? ` · ${device.lastIp}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/50">No device history recorded yet.</p>
        )}

        <form action={formAction} className="space-y-3">
          <FormError id={fieldErrorId("sign-out-others")} message={state?.error} />
          <FormSuccess
            message={state?.success && "Done. Every other device and browser has been signed out."}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Signing out other devices…" : "Sign out everywhere else"}
          </Button>
          <p className="text-xs text-charcoal-ink/50">
            This won&apos;t sign you out here, only on your other devices and browsers. Individual
            devices can&apos;t be signed out one at a time yet.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
