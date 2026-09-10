"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";
import { FormError, fieldErrorId } from "@/components/ui/form-error";

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
        You&apos;re all set, and the app is free
      </h2>
      <p className="text-sm text-charcoal-ink">
        Tracking your readings, your screening calendar, the education library, lifestyle
        coaching, the AI Health Coach and your quarterly report cost nothing, with no time limit
        and no card required.
      </p>
      <p className="text-sm text-charcoal-ink">
        The only thing that costs money is a doctor&apos;s time, and only when you ask for it:
        a written question, a video visit, or the 12-week programme where a doctor manages a
        condition with you. You can see prices and buy any of that any time from your
        dashboard&apos;s My services page; nothing here signs you up for anything.
      </p>

      {/* What the app is FOR, in three lines, before the dashboard rather
          than instead of it. This screen explained the pricing well and the
          product not at all, so the first thing a new patient ever read about
          what they had joined was a dashboard of empty cards. The three items
          are the same three the dashboard's own get-started card then walks
          them through, in the same order, so this reads as a preview of the
          next screen rather than a separate pitch. */}
      <div className="rounded-lg bg-white/70 p-4">
        <p className="text-sm font-semibold text-charcoal-ink">What happens next</p>
        <ul className="mt-2 space-y-2 text-sm text-charcoal-ink">
          <li className="flex gap-2">
            <span aria-hidden className="font-semibold text-brand-green">1.</span>
            <span>
              Answer a few questions about your health. That builds your own screening and
              vaccination calendar, so you know which checks are due and when.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="font-semibold text-brand-green">2.</span>
            <span>
              Log your readings: blood pressure, blood sugar, weight. Any meter, typed in by
              hand. A care team looks at what you log.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="font-semibold text-brand-green">3.</span>
            <span>
              Add the medicines you take, and the app reminds you about doses and refills.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-charcoal-ink/70">
          If a reading ever looks dangerous, you are told straight away what to do, on every
          plan, whether or not you have paid for anything.
        </p>
      </div>
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
          {pending ? "Finishing…" : "Take me to my dashboard"}
        </Button>
      </form>
      <FormError id={fieldErrorId("onboarding-finish")} message={error} />
    </div>
  );
}
