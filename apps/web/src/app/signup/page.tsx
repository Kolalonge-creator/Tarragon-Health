import Link from "next/link";
import { Check } from "lucide-react";
import { SignupForm } from "./signup-form";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";

/**
 * The first screen a new user sees, so nothing on it may outlive the business
 * model. Subscription plans were retired in favour of a free app plus
 * per-piece-of-work doctor time, and Tarragon does not book or bill labs on a
 * patient's behalf, so "free to start" (there is nothing to start paying for),
 * "at no extra cost" (there is no ladder to be at the bottom of), "book the
 * lab" and "pick a partner lab" have all been rewritten to what is true today
 * and to match the marketing pages that feed this page.
 */
const BENEFITS = [
  "Free to use, with no card required",
  "Track vitals, medications and screenings in one place",
  "Your care team follows up when something needs attention",
  "Name a next of kin, and keep your children's vaccination records with yours",
];

/**
 * Shown instead of the general list when somebody arrives from a "book a
 * check" call to action (/signup?intent=health_check). They are not shopping
 * for a subscription, so the page should not read like a plan pitch: it should
 * confirm the thing they clicked is real, unsubscribed, and a few steps away.
 */
const HEALTH_CHECK_BENEFITS = [
  "Nothing to subscribe to: the app is free and the Health Check is a one-off",
  "You see the exact price and confirm before anything is charged",
  "Take your request to any laboratory you like; results land in a record that stays yours",
  "A doctor reviews your results with you, including the all-clear ones",
];

/**
 * For somebody paying for a relative's care rather than their own
 * (/signup?intent=support). The promise here is different in kind: not "we
 * will look after you" but "you will know what your money did". It also has to
 * be honest that they cannot simply read their mother's record — she decides
 * that, from her own account.
 */
const SUPPORT_BENEFITS = [
  "Pay for their plan, their checks or their refills on your card",
  "See what your money actually paid for, itemised",
  "They keep their own account and their own records, and they choose what you can see",
  "No health questions for you: this account is for paying, not for being treated",
];

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; intent?: string }>;
}) {
  const { ref, intent } = await searchParams;
  const bookingCheck = intent === "health_check";
  // Someone here to pay for a relative's care. They are not signing up to be
  // treated, so we neither promise them care nor ask them to consent to it.
  const supporting = intent === "support";

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
        </div>

        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
            {bookingCheck
              ? "Book your Health Check"
              : supporting
                ? "Support someone's care"
                : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            {bookingCheck
              ? "We need an account to hold your results and your history. A short setup, then you choose where to have the test done."
              : supporting
                ? "For paying for someone else's care in Nigeria. We only ask for what we need to bill you, and no health questions, because this account is not for treating you."
                : "A couple of minutes to set up. Your care team takes it from there."}
          </p>
        </div>

        <div className="rounded-2xl border border-brand-green/15 bg-soft-sage/50 p-5">
          <ul className="space-y-2.5">
            {(bookingCheck
              ? HEALTH_CHECK_BENEFITS
              : supporting
                ? SUPPORT_BENEFITS
                : BENEFITS
            ).map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-charcoal-ink/80">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" strokeWidth={2.5} />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <SignupForm
            refCode={ref}
            intent={bookingCheck ? "health_check" : supporting ? "support" : undefined}
          />
        </div>

        <p className="text-center text-sm text-charcoal-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-green hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
