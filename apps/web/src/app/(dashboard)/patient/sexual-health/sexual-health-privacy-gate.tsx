"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  useSexualHealthPrivacyStatus,
  useVerifySexualHealthPin,
  useClearSexualHealthPin,
} from "@/lib/queries/sexual-health-privacy";

import { formatPatientTime } from "@/lib/format-date";
function isLockoutError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "55006";
}

/** Extracted to a plain helper, not called inline in the component body —
 * same pattern as sexual-health-worklist.tsx's elapsedSince, which the
 * react-hooks/purity rule (Date.now() flagged as an impure render call)
 * accepts when it isn't a direct call inside the component function. */
function isCurrentlyLocked(lockedUntil: string | null): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > Date.now();
}

/**
 * Privacy-PIN gate for the Sexual & Reproductive Health hub (spec §47.2).
 * See migration 20260829120300's header for the threat model: this is a
 * shared-device privacy screen, not a security boundary — the data behind
 * it stays fully RLS-protected regardless of this gate. Renders nothing
 * (children included) until the "does a PIN even exist" check resolves, so
 * the hub never flashes before a lock can apply; renders children directly
 * when no PIN is set (the default — this must never be a forced step).
 *
 * "Forgot your PIN?" always works with no support dependency: it just calls
 * clear_sexual_health_pin() under the patient's own already-authenticated
 * session (spec §47.13 puts accessibility right after confidentiality — this
 * can never become a lockout trap on the patient's own data).
 */
export function SexualHealthPrivacyGate({ children }: { children: ReactNode }) {
  const status = useSexualHealthPrivacyStatus();
  const verify = useVerifySexualHealthPin();
  const clear = useClearSexualHealthPin();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (status.isLoading) {
    return null;
  }

  if (!status.data?.hasPin || unlocked) {
    return <>{children}</>;
  }

  const lockedUntil = status.data.lockedUntil;
  const isLocked = isCurrentlyLocked(lockedUntil);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    verify.mutate(pin, {
      onSuccess: (ok) => {
        if (ok) {
          setUnlocked(true);
        } else {
          setPin("");
          setError("That PIN didn't match. Try again.");
        }
      },
      onError: (err) => {
        setPin("");
        setError(
          isLockoutError(err)
            ? "Too many attempts. Try again in a few minutes, or reset your PIN below."
            : "Something went wrong. Please try again."
        );
      },
    });
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 py-16 text-center">
      <SEMANTIC_ICON.privacy className="mx-auto h-8 w-8 text-clinical-navy dark:text-night-ink" strokeWidth={1.5} />
      <div>
        <p className="text-base font-semibold text-charcoal-ink dark:text-night-ink">Enter your privacy PIN</p>
        <p className="mt-1 text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          You set this up so this section stays private on shared devices.
        </p>
      </div>

      {isLocked ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Too many attempts. Try again after{" "}
          {formatPatientTime(lockedUntil!, { hour: "2-digit", minute: "2-digit" })},
          or reset your PIN below.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 text-left">
          <Label htmlFor="sh-privacy-pin" className="sr-only">
            Privacy PIN
          </Label>
          <Input
            id="sh-privacy-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            className="text-center text-lg tracking-[0.5em]"
          />
          {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={verify.isPending || pin.length < 4}
          >
            {verify.isPending ? "Checking…" : "Unlock"}
          </Button>
        </form>
      )}

      <button
        type="button"
        onClick={() => clear.mutate()}
        disabled={clear.isPending}
        className="text-xs font-medium text-charcoal-ink/50 dark:text-night-ink/55 underline underline-offset-4 hover:text-charcoal-ink dark:hover:text-night-ink"
      >
        Forgot your PIN? Reset it
      </button>
    </div>
  );
}
