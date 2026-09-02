"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";

/**
 * Shown instead of the "Choose your plan" step when the caller already has
 * an active/trialing subscription (see onboarding/page.tsx). Without this,
 * a returning patient whose `onboarding_completed_at` gets cleared for any
 * reason — a data migration, an account-recovery flow, anything — was walked
 * straight into "choose a plan and pay" with zero acknowledgment they were
 * already a paying customer. Two real risks that fixes: (1) it read like
 * their subscription had vanished, and (2) `startCheckout` had nothing
 * stopping them from actually creating a second paid subscription and being
 * charged twice (that path is now also blocked server-side as a second,
 * independent safeguard — see the guard at the top of startCheckout).
 */
export function ExistingPlanNotice({ planName, status }: { planName: string; status: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-xl border border-brand-green/30 bg-brand-green/[0.04] p-6 shadow-sm">
      <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
        We found your existing plan
      </h2>
      <p className="text-sm text-charcoal-ink">
        Your account already has{" "}
        <strong className="font-semibold">
          {planName}
          {status === "pending_payment" ? " (payment pending)" : ""}
        </strong>{" "}
        active. You won&apos;t be asked to choose or pay for a plan again: this just finishes
        setting up your account with the plan you already have.
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
          {pending ? "Continuing…" : "Continue to my dashboard"}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-center text-xs text-charcoal-ink/50">
        This isn&apos;t right, or you meant to change plans? You can do that any time from your
        dashboard&apos;s My services page instead.
      </p>
    </div>
  );
}
