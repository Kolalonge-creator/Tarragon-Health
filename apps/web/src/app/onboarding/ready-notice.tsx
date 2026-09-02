"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";

/**
 * Replaces the old "Choose your plan" step. The app has no plan to choose —
 * it is free, and Tarragon charges only for a doctor's time, priced per
 * piece of work, bought later from the dashboard when a patient actually
 * wants one. This is also where the onboarding currency selector used to
 * live (a naira/dollar toggle in front of a diaspora price list that never
 * had a working Stripe integration behind it); removing the toggle rather
 * than fixing it, since there is nothing left here to choose a currency for.
 */
export function ReadyNotice() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-xl border border-brand-green/25 bg-brand-green/[0.04] p-6 shadow-sm">
      <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
        You&apos;re all set — the app is free
      </h2>
      <p className="text-sm text-charcoal-ink">
        Tracking your readings, your screening calendar, the education library, lifestyle
        coaching, the AI Health Coach and your quarterly report cost nothing, with no time limit
        and no card required.
      </p>
      <p className="text-sm text-charcoal-ink">
        The only thing that costs money is a doctor&apos;s time, and only when you ask for it —
        a written question, a video visit, or the 12-week programme where a doctor manages a
        condition with you. You can see prices and buy any of that any time from your
        dashboard&apos;s My services page; nothing here signs you up for anything.
      </p>
      <form
        action={async () => {
          setPending(true);
          setError(null);
          try {
            await completeOnboarding();
          } catch (err) {
            // completeOnboarding() ends in redirect(), which Next.js
            // implements by throwing — that's the success path, not a
            // failure, so only report an error if this ever throws
            // something else.
            const isRedirect =
              typeof err === "object" && err !== null && "digest" in err &&
              String((err as { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT");
            if (!isRedirect) {
              setPending(false);
              setError("Couldn't continue. Please try again, or refresh the page.");
            }
          }
        }}
      >
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Finishing…" : "Continue to my dashboard"}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
