"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { checkEligibility, type EligibilityState } from "./eligibility-actions";

/**
 * "Is your organisation covered?": instant answer or lead capture, the
 * Omada/One Medical pattern. Requires the visitor's own phone number plus the
 * organisation name, so the answer only ever confirms a combination the
 * visitor already knows; never a directory lookup.
 */
export function EligibilityChecker({ source }: { source: "corporate" | "hmo" }) {
  const [state, formAction, isPending] = useActionState<EligibilityState, FormData>(
    checkEligibility,
    undefined
  );

  const noun = source === "hmo" ? "HMO" : "employer";

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 shadow-sm">
      <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">
        Is your {noun} already covered?
      </h3>
      <p className="mt-2 text-charcoal-ink/70">
        Enter your {noun}&apos;s name and the phone number they have on file for you;
        we&apos;ll tell you instantly.
      </p>
      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="source" value={source} />
        <div>
          <label htmlFor="elig-company" className="text-sm font-medium text-charcoal-ink">
            {source === "hmo" ? "HMO name" : "Company name"}
          </label>
          <input
            id="elig-company"
            name="company"
            required
            className="mt-1 w-full rounded-lg border border-charcoal-ink/15 px-3 py-2 text-sm"
            placeholder={source === "hmo" ? "e.g. Reliance HMO" : "e.g. Acme Nigeria Ltd"}
          />
        </div>
        <div>
          <label htmlFor="elig-phone" className="text-sm font-medium text-charcoal-ink">
            Your phone number
          </label>
          <input
            id="elig-phone"
            name="phone"
            type="tel"
            required
            className="mt-1 w-full rounded-lg border border-charcoal-ink/15 px-3 py-2 text-sm"
            placeholder="e.g. 0803 123 4567"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Checking…" : "Check my coverage"}
        </Button>
      </form>
      {state && "error" in state && (
        <p className="mt-4 text-sm text-red-600">{state.error}</p>
      )}
      {state && "status" in state && state.status === "covered" && (
        <div className="mt-4 rounded-lg border border-brand-green/25 bg-brand-green/[0.06] p-4">
          <p className="text-sm font-medium text-charcoal-ink">
            Good news: {state.orgName} covers you on Tarragon.
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/70">
            Sign up with this same phone number and your coverage attaches automatically.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/signup">Create my account</Link>
          </Button>
        </div>
      )}
      {state && "status" in state && state.status === "partner_no_match" && (
        <p className="mt-4 text-sm text-charcoal-ink/70">
          {state.orgName} works with Tarragon, but this number isn&apos;t on their list yet;
          ask your HR or plan administrator to add you, or{" "}
          <Link href="/contact" className="text-brand-green hover:underline">
            contact us
          </Link>
          .
        </p>
      )}
      {state && "status" in state && state.status === "no_partner" && (
        <p className="mt-4 text-sm text-charcoal-ink/70">
          We don&apos;t work with them yet; we&apos;ve noted the interest. Want it sooner?{" "}
          <Link href="/contact" className="text-brand-green hover:underline">
            Introduce us to your {noun}
          </Link>
          . Most partnerships start exactly this way.
        </p>
      )}
    </div>
  );
}
