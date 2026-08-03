"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createEmergencyCardAction,
  revokeEmergencyCardAction,
} from "@/lib/emergency/actions";

/**
 * Create, rotate and withdraw controls.
 *
 * Consent is asked for at the moment of creation, in plain language naming
 * exactly what a stranger would see — not buried in a policy page. Rotating and
 * withdrawing are given equal prominence to creating, because a lost printed
 * card is the realistic risk here and the answer to it must be obvious.
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
        <label className="flex items-start gap-2 text-sm text-charcoal-ink/85">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-1"
          />
          <span>
            I understand that anyone holding this card or its link can see my name, date of birth,
            blood group and genotype, allergies, current medicines, ongoing conditions and my
            emergency contact, without signing in. I can withdraw it at any time.
          </span>
        </label>
        <Button
          type="button"
          disabled={pending || !consented}
          onClick={() => run(createEmergencyCardAction)}
        >
          {pending ? "Creating…" : "Create my emergency card"}
        </Button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-brand-green">{message}</p> : null}
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
          {pending ? "Working…" : "Replace with a new card"}
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
            Withdraw my card
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Replacing issues a new link and stops the old one working — use it if you lose a printed
        copy.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-brand-green">{message}</p> : null}
    </div>
  );
}
