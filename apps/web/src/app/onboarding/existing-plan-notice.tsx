"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "./actions";
import { FormError, fieldErrorId } from "@/components/ui/form-error";

/**
 * Shown instead of the free-app confirmation (see ready-notice.tsx) when the
 * caller already has something active: a legacy pack still running, or a
 * paid service (the 12-week programme, a credit) bought before finishing
 * onboarding. Without this, a returning patient whose `onboarding_completed_at`
 * gets cleared for any reason — a data migration, an account-recovery flow,
 * anything — was walked straight past what they already had with zero
 * acknowledgment. There is no purchase flow left in onboarding to duplicate
 * (see onboarding/page.tsx for existingPlan's source), so this is now purely
 * informational rather than also a second guard against a double charge.
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
      <FormError id={fieldErrorId("onboarding-existing-plan")} message={error} />
      <p className="text-center text-xs text-charcoal-ink/50">
        This isn&apos;t right, or you meant to change plans? You can do that any time from your
        dashboard&apos;s My services page instead.
      </p>
    </div>
  );
}
