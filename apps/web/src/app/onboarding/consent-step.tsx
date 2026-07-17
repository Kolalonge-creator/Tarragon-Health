"use client";

import { useActionState, useEffect } from "react";
import { useCurrentConsentVersions } from "@/lib/queries/consent";
import { acceptConsents } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Step 1 of onboarding. Renders the actual consent text (data processing,
 * remote care, terms) and records acceptance of every current version. This
 * is a hard gate — the profiles_enforce_onboarding_prereqs trigger blocks
 * finishing onboarding until these are on file.
 */
export function ConsentStep({ onComplete }: { onComplete: () => void }) {
  const { data: versions, isLoading } = useCurrentConsentVersions();
  const [state, formAction, pending] = useActionState(acceptConsents, undefined);

  useEffect(() => {
    if (state?.success) onComplete();
  }, [state?.success, onComplete]);

  return (
    <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          Your agreement
        </h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Please read and agree before we set up your care.
        </p>
      </div>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

      <div className="space-y-3">
        {versions?.map((version) => (
          <details
            key={version.id}
            className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3"
          >
            <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">
              {version.title}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/80">{version.body}</p>
          </details>
        ))}
      </div>

      <form action={formAction} className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input
            type="checkbox"
            name="accept"
            className="mt-0.5 h-4 w-4 rounded border-charcoal-ink/30"
            required
          />
          <span>
            I have read and agree to how my health information is used, to receive remote
            care, and to the terms of service.
          </span>
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Button type="submit" disabled={pending || isLoading}>
          {pending ? "Saving…" : "I agree — continue"}
        </Button>
      </form>
    </div>
  );
}
