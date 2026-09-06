"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createEmergencyCardAction,
  revokeEmergencyCardAction,
} from "@/lib/emergency/actions";

/**
 * Create, rotate and withdraw controls for the LIVE LINK — the opt-in extra
 * on top of the printed card, not the default (see the parent page's
 * 2026-08-03 redesign).
 *
 * Consent is asked for at the moment of creation, in plain language naming
 * exactly what a stranger would see AND that this is a different, ongoing
 * exposure from the printed card — not buried in a policy page. Rotating and
 * withdrawing are given equal prominence to creating, because a lost or
 * unwanted link is the realistic risk here and the answer to it must be
 * obvious.
 */
export function EmergencyCardControls({ hasActiveCard }: { hasActiveCard: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  function run(action: () => Promise<{ error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
      setConfirmingRevoke(false);
    });
  }

  if (!hasActiveCard) {
    return (
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-charcoal-ink/85 dark:text-night-ink/85">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-1"
          />
          <span>
            I understand this is a different, ongoing exposure from my printed card: anyone holding
            this link can see my name, date of birth, blood group and genotype, allergies, current
            medicines, ongoing conditions and my emergency contact, without signing in, for as long
            as it stays active. It lasts 12 months and I&rsquo;ll be reminded before it expires. I
            can withdraw it sooner at any time, and I&rsquo;ll be told every time it&rsquo;s viewed.
          </span>
        </label>
        <Button
          type="button"
          disabled={pending || !consented}
          onClick={() => run(createEmergencyCardAction)}
        >
          {pending ? "Creating…" : "Create a live link"}
        </Button>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-brand-green dark:text-brand-green-bright">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run(createEmergencyCardAction)}
        >
          {pending ? "Working…" : "Replace with a new link"}
        </Button>
        {confirmingRevoke ? (
          <>
            <Button
              type="button"
              variant="default"
              disabled={pending}
              onClick={() => run(revokeEmergencyCardAction)}
            >
              Yes, withdraw it
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmingRevoke(false)}
            >
              Keep it
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmingRevoke(true)}
          >
            Withdraw my link
          </Button>
        )}
      </div>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Replacing issues a new link, resets its 12-month clock, and stops the old one working
        immediately. Use it if you ever share the old one by mistake.
      </p>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-brand-green dark:text-brand-green-bright">{message}</p> : null}
    </div>
  );
}
