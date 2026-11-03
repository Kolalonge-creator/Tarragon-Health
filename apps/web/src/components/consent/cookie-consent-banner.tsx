"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { setStoredConsent, useCookieConsent, type CookieConsentChoice } from "@/lib/consent";
import { isMarketingPath } from "@/lib/marketing/routes";

/**
 * Shown only on the public marketing site (never inside the signed-in app,
 * where the same anonymous analytics is a disclosed, in-Terms part of
 * running the product rather than an anonymous-visitor tracking notice).
 * Stays hidden once a choice is stored; reopens only via "Change my cookie
 * preferences" on the Cookie Policy page, which clears the stored choice.
 *
 * Opt-out: analytics already runs by default the moment the page loads —
 * this banner is a disclosure + an easy way to turn it off, not a gate.
 */
export function CookieConsentBanner() {
  const pathname = usePathname();
  const consent = useCookieConsent();

  if (!isMarketingPath(pathname)) return null;
  if (consent !== null) return null;

  const choose = (choice: CookieConsentChoice) => {
    setStoredConsent(choice);
  };

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-charcoal-ink/10 bg-white px-4 py-4 shadow-[0_-4px_24px_rgba(18,50,75,0.12)] sm:px-6 sm:py-5"
    >
      {/* Kept short on purpose: on a phone this banner sits over the hero,
          so every extra line here is a line of the page a visitor cannot
          see. The full reasoning lives on the Cookie Policy page. */}
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-charcoal-ink/80">
          One required cookie keeps you signed in. We also collect anonymous,
          first-party analytics unless you say no: no ads, no third-party
          trackers, no session recording.{" "}
          <Link href="/cookies" className="underline hover:text-deep-forest">
            Cookie Policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => choose("rejected")}>
            Reject non-essential
          </Button>
          <Button size="sm" className="flex-1 sm:flex-none" onClick={() => choose("accepted")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
