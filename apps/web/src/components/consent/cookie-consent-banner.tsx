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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-charcoal-ink/10 bg-white px-4 py-5 shadow-[0_-4px_24px_rgba(18,50,75,0.12)] sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-charcoal-ink/80">
          We use one required cookie to keep you securely signed in. We also collect
          anonymous, first-party analytics, to see which pages help people find care,
          unless you tell us not to: no ads, no third-party tracker, and no session
          recording, ever. Read our{" "}
          <Link href="/cookies" className="underline hover:text-deep-forest">
            Cookie Policy
          </Link>{" "}
          for the full detail, or choose below.
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" size="sm" onClick={() => choose("rejected")}>
            Reject Non-Essential
          </Button>
          <Button size="sm" onClick={() => choose("accepted")}>
            Accept All
          </Button>
        </div>
      </div>
    </div>
  );
}
