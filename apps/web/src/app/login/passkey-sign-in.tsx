"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { beginPasskeySignIn, finishPasskeySignIn } from "@/lib/passkeys/actions";
import { PASSKEY_MESSAGES } from "@/lib/passkeys/messages";
import { passkeyHintedOnThisDevice, runAuthenticationCeremony, webAuthnSupported } from "@/lib/passkeys/webauthn-json";

const noopSubscribe = () => () => undefined;

/**
 * "Use a passkey" on the sign-in page. A quiet extra under the normal forms, never in front of them.
 *
 * Shown only when the platform switch is on (`enabled`, decided on the server), this browser can run WebAuthn, AND this device
 * has been used with a passkey before. The last test is a small note kept on the device itself: the page cannot ask the server
 * "does this person have a passkey?" before anyone has said who they are, and must not (that would reveal which accounts exist).
 * A person whose passkey was made on another device simply signs in the usual way here.
 */
export function PasskeySignIn({ enabled, redirectTo }: { enabled: boolean; redirectTo?: string }) {
  const deviceCanAndHas = useSyncExternalStore(noopSubscribe, () => webAuthnSupported() && passkeyHintedOnThisDevice(), () => false);
  const visible = enabled && deviceCanAndHas;
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (!visible) return null;

  function run() {
    setError(undefined);
    startTransition(async () => {
      const started = await beginPasskeySignIn();
      if (!started.ok) {
        setError(started.error);
        return;
      }
      const ceremony = await runAuthenticationCeremony(started.options);
      if (!ceremony.ok) {
        // A cancelled prompt is not an error worth shouting about; the normal forms are right above.
        setError(ceremony.reason === "cancelled" ? undefined : PASSKEY_MESSAGES.signInFailed);
        return;
      }
      // On success the server redirects; we only get a value back when it did not.
      const done = await finishPasskeySignIn({ challengeId: started.challengeId, credential: ceremony.credential, redirectTo });
      if (done && !done.ok) setError(done.error);
    });
  }

  return (
    <div className="mt-5 border-t border-charcoal-ink/10 pt-5 text-center">
      <Button type="button" variant="outline" className="w-full rounded-xl" disabled={pending} onClick={run}>
        {pending ? "Waiting for your device..." : "Use a passkey"}
      </Button>
      <div className="mt-2">
        <FormError id="passkey-signin-error" message={error} />
      </div>
    </div>
  );
}
