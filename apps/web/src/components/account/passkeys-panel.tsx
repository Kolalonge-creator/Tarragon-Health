"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { formatPatientDate } from "@/lib/format-date";
import { beginPasskeyRegistration, cancelPasskeyAdd, finishPasskeyRegistration, removePasskey, renamePasskey } from "@/lib/passkeys/actions";
import { PASSKEY_MESSAGES } from "@/lib/passkeys/messages";
import {
  forgetPasskeyOnThisDevice,
  rememberPasskeyOnThisDevice,
  runRegistrationCeremony,
  webAuthnSupported,
} from "@/lib/passkeys/webauthn-json";

const noopSubscribe = () => () => undefined;

export type PasskeyRow = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

/**
 * Passkeys (optional). Add, name, list and remove. A passkey is an extra way to sign in on a device you trust; the phone number,
 * email and password routes are never changed by it. Adding one needs the account password again.
 */
export function PasskeysPanel({ passkeys, canAdd, labelMax }: { passkeys: PasskeyRow[]; canAdd: boolean; labelMax: number }) {
  // False on the server and during hydration, then the browser's real answer: no state-in-effect needed.
  const supported = useSyncExternalStore(noopSubscribe, webAuthnSupported, () => false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(form: FormData) {
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    setMessage(null);
    startTransition(async () => {
      const started = await beginPasskeyRegistration(password);
      if (!started.ok) {
        setMessage({ kind: "error", text: started.error });
        return;
      }
      const ceremony = await runRegistrationCeremony(started.options);
      if (!ceremony.ok) {
        await cancelPasskeyAdd();
        setMessage({
          kind: "error",
          text: ceremony.reason === "unsupported" ? PASSKEY_MESSAGES.unsupported : ceremony.reason === "cancelled" ? PASSKEY_MESSAGES.cancelled : PASSKEY_MESSAGES.generic,
        });
        return;
      }
      const done = await finishPasskeyRegistration({ challengeId: started.challengeId, credential: ceremony.credential, label: name });
      if (!done.ok) {
        setMessage({ kind: "error", text: done.error });
        return;
      }
      rememberPasskeyOnThisDevice();
      setAdding(false);
      setMessage({
        kind: "ok",
        text: done.named
          ? "Passkey added. We have also told you by email and in the app."
          : "Passkey added, but we could not save its name. You can rename it below. We have also told you by email and in the app.",
      });
    });
  }

  function rename(form: FormData) {
    const id = String(form.get("id") ?? "");
    const name = String(form.get("name") ?? "");
    setMessage(null);
    startTransition(async () => {
      const res = await renamePasskey({ id, label: name });
      if (!res.ok) setMessage({ kind: "error", text: res.error });
      else setRenamingId(null);
    });
  }

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await removePasskey({ id });
      if (!res.ok) {
        setMessage({ kind: "error", text: res.error });
        return;
      }
      setConfirmRemoveId(null);
      if (passkeys.length <= 1) forgetPasskeyOnThisDevice();
      setMessage({ kind: "ok", text: "Passkey removed." });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Passkeys (optional)</CardTitle>
        <CardDescription>
          A passkey lets you sign in with your fingerprint, face or screen lock instead of typing. It is an extra for devices you
          trust. Most people do not need one. You can always sign in with your phone number or email, and adding or removing a
          passkey changes nothing about that.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {passkeys.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70" role="status">
            You have no passkeys.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Your passkeys">
            {passkeys.map((p) => (
              <li key={p.id} className="rounded-md border border-charcoal-ink/15 p-3">
                {renamingId === p.id ? (
                  <form action={rename} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <div className="space-y-1.5">
                      <Label htmlFor={`passkey-name-${p.id}`}>Name</Label>
                      <Input id={`passkey-name-${p.id}`} name="name" defaultValue={p.name} maxLength={labelMax} required />
                    </div>
                    <Button type="submit" size="sm" disabled={pending}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRenamingId(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-charcoal-ink/60">
                        Added {formatPatientDate(p.createdAt)}
                        {p.lastUsedAt ? `, last used ${formatPatientDate(p.lastUsedAt)}` : ", not used yet"}
                      </p>
                    </div>
                    {confirmRemoveId === p.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">Remove this passkey?</span>
                        <Button type="button" size="sm" disabled={pending} onClick={() => remove(p.id)}>
                          Yes, remove
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemoveId(null)}>
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {canAdd && (
                          <Button type="button" size="sm" variant="outline" onClick={() => setRenamingId(p.id)}>
                            Rename
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemoveId(p.id)}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canAdd && !supported && <p className="text-sm text-charcoal-ink/70">{PASSKEY_MESSAGES.unsupported}</p>}

        {canAdd && supported && (adding ? (
          <form action={add} className="space-y-3">
            <p className="text-sm">
              Your device will ask for your fingerprint, face or screen lock. We will tell you by email and in the app that a passkey
              was added.
            </p>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="passkey-new-name">Give it a name</Label>
              <Input id="passkey-new-name" name="name" placeholder="My phone" maxLength={labelMax} required />
            </div>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="passkey-password">Your password, to check it is you</Label>
              <PasswordInput id="passkey-password" name="password" autoComplete="current-password" required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Waiting for your device..." : "Add passkey"}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            Add a passkey
          </Button>
        ))}

        {message?.kind === "ok" && (
          <p role="status" className="text-sm text-brand-green">
            {message.text}
          </p>
        )}
        <FormError id="passkeys-error" message={message?.kind === "error" ? message.text : undefined} />
        <p className="text-xs text-charcoal-ink/60">You can always sign in with your phone number.</p>
      </CardContent>
    </Card>
  );
}
