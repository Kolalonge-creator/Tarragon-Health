"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { PIN_PROBLEM_TEXT, getPrivateLockConfig } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePrivateLock } from "./use-private-lock";
import { requestPrivateSectionRecoveryCode, verifyPrivateSectionRecoveryCode, type PrivateSectionRecoveryState } from "./recovery-actions";
import { PRIVATE_SECTION_COPY as COPY } from "./copy";

/**
 * PrivateSection (S66): the reusable gate for any section whose content must stay private on a shared screen. Cycle uses it now; pregnancy,
 * postnatal and other private sections wrap their body in the same component (S67 to S69).
 *
 *   <PrivateSection accountId={userId} title="Your cycle" outside={<DangerSigns />}>
 *     ...private content...
 *   </PrivateSection>
 *
 *  - `accountId`  the signed-in account. Keys the stored PIN so a shared computer keeps one PIN per account.
 *  - `title`      what the locked screen calls the section. Keep it neutral (it is shown while locked).
 *  - `outside`    content that must NEVER be locked: emergency and danger-sign guidance. It is rendered in every state (setup, locked,
 *                 unlocked) above the gate and holds no personal data.
 *  - `children`   the private content. Not rendered at all, not even hidden, until unlocked, so it is not in the page while locked.
 *
 * Optional but ON BY DEFAULT: with no saved choice the first visit asks to set a PIN, or to turn the lock off on purpose (remembered).
 * Locked again after the tab has been hidden for longer than `private_section.lock.relock_after_background_seconds`.
 * Forgotten PIN: a code to the account's own phone, then a new PIN. Nothing on the server is touched.
 */
export function PrivateSection({ accountId, title, outside, children }: { accountId: string; title: string; outside?: ReactNode; children: ReactNode }) {
  const lock = usePrivateLock(accountId);
  return (
    <div className="space-y-6">
      {outside}
      {lock.status === "loading" && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-charcoal-ink/60 dark:text-night-ink/60" role="status">
            {COPY.loading}
          </CardContent>
        </Card>
      )}
      {lock.status === "needs_setup" && <SetupCard title={title} lock={lock} />}
      {lock.status === "locked" && <UnlockCard title={title} lock={lock} />}
      {(lock.status === "unlocked" || lock.status === "disabled") && (
        <>
          {lock.status === "unlocked" && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void lock.lock()}>
                {COPY.lockNow}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void lock.turnOff()}>
                {COPY.turnOffLock}
              </Button>
            </div>
          )}
          {lock.status === "disabled" && (
            <div className="flex justify-end">
              {/* No PIN exists while the lock is off, so there is nothing to re-verify: this only clears the "no lock" choice. */}
              <Button type="button" size="sm" variant="ghost" onClick={() => void lock.resetAfterReverification()}>
                {COPY.turnOnLock}
              </Button>
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}

function SetupCard({ title, lock }: { title: string; lock: ReturnType<typeof usePrivateLock> }) {
  const cfg = getPrivateLockConfig();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirm) return setError(COPY.pinsDiffer);
    setBusy(true);
    const r = await lock.setupPin(pin);
    setBusy(false);
    if (!r.ok) setError(r.reason === "storage_failed" ? COPY.storageFailed : r.reason === "biometric_unavailable" ? COPY.storageFailed : PIN_PROBLEM_TEXT[r.reason]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{COPY.setupIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" aria-describedby="private-pin-help">
          <div className="space-y-1.5">
            <Label htmlFor="private-pin">{COPY.newPin}</Label>
            <Input id="private-pin" inputMode="numeric" autoComplete="new-password" type="password" maxLength={cfg.pinMaxDigits} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="max-w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="private-pin-confirm">{COPY.confirmPin}</Label>
            <Input id="private-pin-confirm" inputMode="numeric" autoComplete="new-password" type="password" maxLength={cfg.pinMaxDigits} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} className="max-w-40" />
          </div>
          <p id="private-pin-help" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {COPY.pinHelp.replace("{min}", String(cfg.pinMinDigits)).replace("{max}", String(cfg.pinMaxDigits))}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || pin.length < cfg.pinMinDigits}>
              {busy ? COPY.saving : COPY.setPin}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void lock.turnOff()}>
              {COPY.noLock}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UnlockCard({ title, lock }: { title: string; lock: ReturnType<typeof usePrivateLock> }) {
  const cfg = getPrivateLockConfig();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await lock.unlockWithPin(pin);
    setPin("");
    if (r.ok) return setMessage(null);
    if (r.reason === "locked_out") return setMessage(COPY.lockedOut.replace("{seconds}", String(r.retryAfterSeconds)));
    if (r.reason === "wrong_pin") return setMessage(COPY.wrongPin);
    setMessage(COPY.storageFailed);
  }

  if (forgot) return <RecoveryCard onDone={() => setForgot(false)} lock={lock} />;
  const lockedOut = lock.lockoutSeconds > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{COPY.unlockIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="private-pin-unlock">{COPY.enterPin}</Label>
            <Input id="private-pin-unlock" inputMode="numeric" autoComplete="current-password" type="password" maxLength={cfg.pinMaxDigits} value={pin} disabled={lockedOut} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="max-w-40" />
          </div>
          {(message || lockedOut) && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {lockedOut ? COPY.lockedOut.replace("{seconds}", String(lock.lockoutSeconds)) : message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={lockedOut || pin.length < cfg.pinMinDigits}>
              {COPY.open}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForgot(true)}>
              {COPY.forgotPin}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RecoveryCard({ lock, onDone }: { lock: ReturnType<typeof usePrivateLock>; onDone: () => void }) {
  const [sent, setSent] = useState<PrivateSectionRecoveryState>(undefined);
  const [sending, setSending] = useState(false);
  const [state, formAction, pending] = useActionState(verifyPrivateSectionRecoveryCode, undefined);

  // A verified code deletes only the local lock record; the page then shows the setup card for a new PIN.
  const verified = state?.success === true;
  const reset = lock.resetAfterReverification;
  useEffect(() => {
    if (verified) void reset();
  }, [verified]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setSending(true);
    setSent(await requestPrivateSectionRecoveryCode());
    setSending(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{COPY.recoveryTitle}</CardTitle>
        <CardDescription>{COPY.recoveryIntro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent?.step !== "code" && (
          <div className="space-y-2">
            <Button type="button" onClick={send} disabled={sending}>
              {sending ? COPY.sending : COPY.sendCode}
            </Button>
            {sent?.error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {sent.error}
              </p>
            )}
          </div>
        )}
        {sent?.step === "code" && (
          <form action={formAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="private-recovery-code">{COPY.codeLabel}</Label>
              <Input id="private-recovery-code" name="token" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-40" />
            </div>
            {state?.error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? COPY.checking : COPY.verifyCode}
            </Button>
          </form>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>
          {COPY.backToPin}
        </Button>
      </CardContent>
    </Card>
  );
}
